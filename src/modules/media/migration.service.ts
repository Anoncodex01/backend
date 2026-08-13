import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { R2Service } from './r2.service';

export interface MigrationProgress {
  total: number;
  migrated: number;
  failed: number;
  skipped: number;
  running: boolean;
}

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);
  private readonly accountId: string;
  private readonly streamApiToken: string;
  private progress: MigrationProgress = { total: 0, migrated: 0, failed: 0, skipped: 0, running: false };

  constructor(
    private configService: ConfigService,
    private supabaseService: SupabaseService,
    private r2Service: R2Service,
  ) {
    this.accountId = this.configService.get<string>('CLOUDFLARE_ACCOUNT_ID', '');
    this.streamApiToken = this.configService.get<string>('CLOUDFLARE_API_TOKEN', '');
  }

  getProgress(): MigrationProgress {
    return { ...this.progress };
  }

  async startMigration(batchSize = 4): Promise<void> {
    if (this.progress.running) {
      this.logger.warn('Migration already running');
      return;
    }

    const supabase = this.supabaseService.getClient();

    // Count total
    const { count } = await supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .not('stream_uid', 'is', null)
      .eq('migrated_to_r2', false);

    this.progress = { total: count ?? 0, migrated: 0, failed: 0, skipped: 0, running: true };
    this.logger.log(`Starting migration of ${this.progress.total} videos`);

    // Run in background (don't await)
    this.runMigration(batchSize).catch((e) => {
      this.logger.error(`Migration crashed: ${e}`);
      this.progress.running = false;
    });
  }

  private async runMigration(batchSize: number): Promise<void> {
    const supabase = this.supabaseService.getClient();

    while (true) {
      // Fetch next batch
      const { data: posts, error } = await supabase
        .from('posts')
        .select('id, stream_uid')
        .not('stream_uid', 'is', null)
        .eq('migrated_to_r2', false)
        .limit(batchSize);

      if (error) {
        this.logger.error(`Batch fetch error: ${error.message}`);
        break;
      }

      if (!posts || posts.length === 0) {
        this.logger.log('Migration complete — no more posts to migrate');
        break;
      }

      // Process batch in parallel
      await Promise.all(posts.map((post: any) => this.migrateOneVideo(post.id, post.stream_uid)));

      this.logger.log(
        `Progress: ${this.progress.migrated} migrated, ${this.progress.failed} failed, ${this.progress.skipped} skipped`,
      );

      // Small delay between batches to avoid overloading VPS
      await this.sleep(2000);
    }

    this.progress.running = false;
    this.logger.log(`Migration finished. Migrated=${this.progress.migrated}, Failed=${this.progress.failed}`);
  }

  private async migrateOneVideo(postId: string, streamUid: string): Promise<void> {
    try {
      // Step 1: Request MP4 download from Cloudflare Stream
      await this.requestMp4Download(streamUid);

      // Step 2: Poll until MP4 is ready (max 10 minutes)
      const downloadUrl = await this.pollUntilReady(streamUid, 120);
      if (!downloadUrl) {
        this.logger.warn(`[${postId}] MP4 not ready after timeout — skipping`);
        this.progress.skipped++;
        return;
      }

      // Step 3: Pipe download directly to R2
      const videoKey = `videos/${postId}/video.mp4`;
      const thumbKey = `thumbnails/${postId}.jpg`;

      const videoResp = await fetch(downloadUrl);
      if (!videoResp.ok || !videoResp.body) {
        throw new Error(`Failed to download MP4: ${videoResp.status}`);
      }

      const { Readable } = await import('stream');
      const videoStream = Readable.fromWeb(videoResp.body as any);
      const videoUrl = await this.r2Service.uploadStream(videoKey, videoStream, 'video/mp4');

      // Step 4: Try to get thumbnail URL from Stream
      let thumbnailUrl = '';
      try {
        const thumbStreamUrl = `https://videodelivery.net/${streamUid}/thumbnails/thumbnail.jpg?time=1s&width=720`;
        const thumbResp = await fetch(thumbStreamUrl);
        if (thumbResp.ok) {
          const thumbBuf = Buffer.from(await thumbResp.arrayBuffer());
          thumbnailUrl = await this.r2Service.uploadBuffer(thumbKey, thumbBuf, 'image/jpeg');
        }
      } catch (_) {
        // thumbnail not critical
      }

      // Step 5: Update Supabase
      const supabase = this.supabaseService.getClient();
      await supabase
        .from('posts')
        .update({
          video_url: videoUrl,
          thumbnail_url: thumbnailUrl || undefined,
          storage_type: 'r2',
          migrated_to_r2: true,
          processing_status: 'completed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', postId);

      this.progress.migrated++;
      this.logger.log(`[${postId}] Migrated ✅ → ${videoUrl}`);

    } catch (err: any) {
      this.progress.failed++;
      this.logger.error(`[${postId}] Migration failed: ${err.message}`);
    }
  }

  private async requestMp4Download(streamUid: string): Promise<void> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/${streamUid}/downloads/default`;
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.streamApiToken}` },
    });
  }

  private async pollUntilReady(streamUid: string, maxAttempts: number): Promise<string | null> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/${streamUid}/downloads`;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${this.streamApiToken}` },
        });
        const data = await resp.json() as any;
        const defaultDownload = data?.result?.default;

        if (defaultDownload?.status === 'ready' && defaultDownload?.url) {
          return defaultDownload.url as string;
        }
      } catch (_) {}

      await this.sleep(5000); // poll every 5 seconds
    }

    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
