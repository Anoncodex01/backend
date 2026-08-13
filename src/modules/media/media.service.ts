import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job } from 'bullmq';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { R2Service } from './r2.service';
import { FfmpegService } from './ffmpeg.service';
import * as fs from 'fs';
import * as path from 'path';

export interface VideoJobData {
  inputPath: string;
  postId: string;
  userId: string;
  originalFilename: string;
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

@Injectable()
export class MediaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaService.name);
  private queue: Queue;
  private worker: Worker;
  private readonly uploadTempDir = '/tmp/whapvibez-uploads';

  constructor(
    private configService: ConfigService,
    private supabaseService: SupabaseService,
    private r2Service: R2Service,
    private ffmpegService: FfmpegService,
  ) {}

  onModuleInit() {
    fs.mkdirSync(this.uploadTempDir, { recursive: true });
    fs.mkdirSync('/tmp/whapvibez-processing', { recursive: true });

    const redisConnection = {
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
    };

    this.queue = new Queue('video-processing', { connection: redisConnection });

    this.worker = new Worker(
      'video-processing',
      async (job: Job<VideoJobData>) => this.processVideoJob(job),
      {
        connection: redisConnection,
        concurrency: 2, // process 2 videos at a time max
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`Job ${job.id} completed`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} failed: ${err.message}`);
    });

    this.logger.log('Video processing queue started');
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  async addVideoJob(data: VideoJobData): Promise<string> {
    const job = await this.queue.add('encode', data, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 5000 },
      removeOnComplete: { age: 86400 }, // keep 24h
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

  private async processVideoJob(job: Job<VideoJobData>): Promise<{ videoUrl: string; thumbnailUrl: string; postId: string }> {
    const { inputPath, postId, userId } = job.data;
    const jobId = job.id!;

    this.logger.log(`[${jobId}] Processing video for post ${postId}`);
    await job.updateProgress(5);

    try {
      // Step 1: Encode with FFmpeg
      this.logger.log(`[${jobId}] Starting FFmpeg encoding`);
      await job.updateProgress(10);

      const encoding = await this.ffmpegService.encodeVideo(inputPath, jobId);
      await job.updateProgress(60);

      // Step 2: Upload thumbnail to R2
      this.logger.log(`[${jobId}] Uploading thumbnail`);
      const thumbKey = `thumbnails/${postId}.jpg`;
      const thumbnailUrl = await this.r2Service.uploadFile(thumbKey, encoding.thumbnailPath, 'image/jpeg');
      await job.updateProgress(70);

      // Step 3: Upload HLS playlist
      this.logger.log(`[${jobId}] Uploading HLS files`);
      const playlistKey = `videos/${postId}/playlist.m3u8`;
      await this.r2Service.uploadFile(playlistKey, encoding.playlistPath, 'application/vnd.apple.mpegurl');
      await job.updateProgress(75);

      // Step 4: Upload all TS segments
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

      // Step 5: Update Supabase
      this.logger.log(`[${jobId}] Updating Supabase`);
      const supabase = this.supabaseService.getClient();
      await supabase
        .from('posts')
        .update({
          video_url: videoUrl,
          thumbnail_url: thumbnailUrl,
          storage_type: 'r2',
          processing_status: 'completed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', postId);

      await job.updateProgress(100);

      // Step 6: Cleanup temp files
      this.ffmpegService.cleanup(encoding.hlsDir);
      this.safeDelete(inputPath);

      this.logger.log(`[${jobId}] Done. videoUrl=${videoUrl}`);
      return { videoUrl, thumbnailUrl, postId };

    } catch (err) {
      this.logger.error(`[${jobId}] Processing failed: ${err}`);

      // Mark post as failed in Supabase
      try {
        const supabase = this.supabaseService.getClient();
        await supabase
          .from('posts')
          .update({ processing_status: 'failed' })
          .eq('id', postId);
      } catch (_) {}

      // Cleanup
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
