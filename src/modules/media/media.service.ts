import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Queue, Worker, Job } from 'bullmq';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { R2Service } from './r2.service';
import { FfmpegService } from './ffmpeg.service';
import { FeedService } from '../feed/feed.service';
import * as fs from 'fs';
import * as path from 'path';

export interface VideoJobData {
  inputPath: string;
  postId: string;
  userId: string;
  originalFilename: string;
  isDraft?: boolean;
}

export interface JobStatus {
  id: string;
  state: 'waiting' | 'active' | 'completed' | 'failed';
  progress: number;
  postId?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  error?: string;
}

export interface VideoQueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

@Injectable()
export class MediaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaService.name);
  private queue: Queue;
  private worker: Worker;
  private readonly uploadTempDir = '/tmp/whapvibez-uploads';
  private readonly processingTempDir = '/tmp/whapvibez-processing';
  private readonly workerOnly = process.env.VIDEO_WORKER_ONLY === '1';
  private readonly disableWorker = process.env.VIDEO_DISABLE_WORKER === '1';

  constructor(
    private configService: ConfigService,
    private supabaseService: SupabaseService,
    private r2Service: R2Service,
    private ffmpegService: FfmpegService,
    @Optional() @Inject(forwardRef(() => FeedService))
    private feedService?: FeedService,
  ) {}

  onModuleInit() {
    fs.mkdirSync(this.uploadTempDir, { recursive: true });
    fs.mkdirSync(this.processingTempDir, { recursive: true });

    const redisConnection = {
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
    };

    this.queue = new Queue('video-processing', { connection: redisConnection });

    if (this.disableWorker && !this.workerOnly) {
      this.logger.log('Video worker disabled in API container (VIDEO_DISABLE_WORKER=1)');
      return;
    }

    this.worker = new Worker(
      'video-processing',
      async (job: Job<VideoJobData>) => this.processVideoJob(job),
      {
        connection: redisConnection,
        concurrency: 2,
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`Job ${job.id} completed`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} failed: ${err.message}`);
    });

    this.logger.log(
      this.workerOnly
        ? 'Video processing worker started (standalone mode)'
        : 'Video processing queue started',
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  async addVideoJob(data: VideoJobData): Promise<string> {
    const job = await this.queue.add('encode', data, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 5000 },
      removeOnComplete: { age: 86400 },
      removeOnFail: { age: 86400 },
    });
    return job.id!;
  }

  async getJobStatus(jobId: string): Promise<JobStatus | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    const returnValue = job.returnvalue as { videoUrl?: string; thumbnailUrl?: string; postId?: string } | null;

    return {
      id: jobId,
      state: state as JobStatus['state'],
      progress: typeof job.progress === 'number' ? job.progress : 0,
      postId: job.data.postId,
      videoUrl: returnValue?.videoUrl,
      thumbnailUrl: returnValue?.thumbnailUrl,
      error: job.failedReason,
    };
  }

  async getQueueStats(): Promise<VideoQueueStats> {
    const counts = await this.queue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
    );
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
    };
  }

  async listFailedPosts(limit = 50) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('posts')
      .select('id, user_id, caption, created_at, processing_status, processing_error, storage_type')
      .eq('processing_status', 'failed')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  /**
   * Retry a failed encode when the original upload file is still on disk,
   * or re-migrate from Cloudflare Stream when stream_uid exists.
   */
  async retryFailedPost(postId: string): Promise<{ jobId?: string; message: string }> {
    const supabase = this.supabaseService.getClient();
    const { data: post, error } = await supabase
      .from('posts')
      .select('id, user_id, stream_uid, processing_status, storage_type')
      .eq('id', postId)
      .maybeSingle();

    if (error || !post) {
      return { message: 'Post not found' };
    }

    if (post.processing_status !== 'failed') {
      return { message: 'Post is not in failed state' };
    }

    // Look for a leftover upload file named with post id prefix (best-effort)
    const uploadDirFiles = fs.existsSync(this.uploadTempDir)
      ? fs.readdirSync(this.uploadTempDir)
      : [];
    const candidate = uploadDirFiles.find((name) => name.includes(postId));
    if (candidate) {
      const inputPath = path.join(this.uploadTempDir, candidate);
      await supabase
        .from('posts')
        .update({ processing_status: 'processing', processing_error: null })
        .eq('id', postId);
      const jobId = await this.addVideoJob({
        inputPath,
        postId,
        userId: post.user_id,
        originalFilename: candidate,
        isDraft: false,
      });
      return { jobId, message: 'Retry job queued from saved upload file' };
    }

    if (post.stream_uid) {
      return {
        message:
          'Original upload file is gone. Use POST /v1/media/migrate to re-process Stream videos.',
      };
    }

    return {
      message:
        'Cannot retry — original file was cleaned up. User must re-upload the video.',
    };
  }

  @Cron('0 */6 * * *')
  cleanupTempDirectories(): void {
    this.runTempCleanupNow();
  }

  runTempCleanupNow(): void {
    this.purgeOldFiles(this.uploadTempDir, 24 * 60 * 60 * 1000);
    this.purgeOldFiles(this.processingTempDir, 6 * 60 * 60 * 1000);
  }

  private purgeOldFiles(dir: string, maxAgeMs: number): void {
    if (!fs.existsSync(dir)) return;
    const cutoff = Date.now() - maxAgeMs;
    for (const entry of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs < cutoff) {
          if (stat.isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(fullPath);
          }
          this.logger.log(`Cleaned stale temp file: ${fullPath}`);
        }
      } catch (e) {
        this.logger.warn(`Temp cleanup skipped ${fullPath}: ${e}`);
      }
    }
  }

  private async processVideoJob(job: Job<VideoJobData>): Promise<{ videoUrl: string; thumbnailUrl: string; postId: string }> {
    const { inputPath, postId, userId, isDraft } = job.data;
    const jobId = job.id!;

    this.logger.log(`[${jobId}] Processing video for post ${postId}`);
    await job.updateProgress(5);

    try {
      this.logger.log(`[${jobId}] Starting FFmpeg encoding`);
      await job.updateProgress(10);

      const encoding = await this.ffmpegService.encodeVideo(inputPath, jobId);
      await job.updateProgress(60);

      this.logger.log(`[${jobId}] Uploading thumbnail`);
      const thumbKey = `thumbnails/${postId}.jpg`;
      const thumbnailUrl = await this.r2Service.uploadFile(thumbKey, encoding.thumbnailPath, 'image/jpeg');
      await job.updateProgress(70);

      this.logger.log(`[${jobId}] Uploading HLS files`);
      const playlistKey = `videos/${postId}/playlist.m3u8`;
      await this.r2Service.uploadFile(playlistKey, encoding.playlistPath, 'application/vnd.apple.mpegurl');
      await job.updateProgress(75);

      const segmentFiles = fs.readdirSync(encoding.hlsDir).filter((f) => f.endsWith('.ts'));
      const total = segmentFiles.length;
      for (let i = 0; i < total; i++) {
        const segFile = segmentFiles[i];
        const segKey = `videos/${postId}/${segFile}`;
        await this.r2Service.uploadFile(segKey, path.join(encoding.hlsDir, segFile), 'video/MP2T');
        const prog = 75 + Math.round(((i + 1) / total) * 20);
        await job.updateProgress(prog);
      }

      const videoUrl = this.r2Service.getPublicUrl(playlistKey);
      await job.updateProgress(95);

      this.logger.log(`[${jobId}] Updating Supabase`);
      const supabase = this.supabaseService.getClient();
      await supabase
        .from('posts')
        .update({
          video_url: videoUrl,
          thumbnail_url: thumbnailUrl,
          storage_type: 'r2',
          processing_status: 'completed',
          processing_error: null,
          ...(isDraft ? {} : { is_draft: false }),
          updated_at: new Date().toISOString(),
        })
        .eq('id', postId);

      await job.updateProgress(100);

      this.ffmpegService.cleanup(encoding.hlsDir);
      this.safeDelete(inputPath);

      await this.feedService?.invalidateFeedCache();
      await this.feedService?.invalidateFollowingFeed(userId);

      this.logger.log(`[${jobId}] Done. videoUrl=${videoUrl}`);
      return { videoUrl, thumbnailUrl, postId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[${jobId}] Processing failed: ${message}`);

      try {
        const supabase = this.supabaseService.getClient();
        await supabase
          .from('posts')
          .update({
            processing_status: 'failed',
            processing_error: message.slice(0, 500),
          })
          .eq('id', postId);
      } catch (_) {}

      this.safeDelete(inputPath);
      throw err;
    }
  }

  private safeDelete(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
      this.logger.warn(`Could not delete temp file ${filePath}: ${e}`);
    }
  }

  getTempUploadDir(): string {
    return this.uploadTempDir;
  }
}
