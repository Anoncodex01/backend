import { BadGatewayException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);
  private readonly accountId: string;
  private readonly apiToken: string;

  constructor(private configService: ConfigService) {
    this.accountId = this.configService.get<string>('CLOUDFLARE_ACCOUNT_ID', '');
    this.apiToken = this.configService.get<string>('CLOUDFLARE_API_TOKEN', '');
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  async getVideoUploadUrl(maxDurationSeconds = 300): Promise<{ uploadURL: string; uid: string }> {
    if (!this.accountId || !this.apiToken) {
      this.logger.error('Cloudflare Stream credentials are missing');
      throw new InternalServerErrorException('Cloudflare upload is not configured');
    }

    const safeMaxDurationSeconds = Math.min(
      Math.max(Math.ceil(maxDurationSeconds || 300), 1),
      3600,
    );
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/direct_upload`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: this.headers,
        signal: controller.signal,
        body: JSON.stringify({
          maxDurationSeconds: safeMaxDurationSeconds,
          downloadable: true,
          meta: { name: 'WhapVibez Upload' },
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Cloudflare direct upload request failed: ${message}`);
      throw new BadGatewayException('Cloudflare upload service unavailable');
    } finally {
      clearTimeout(timeout);
    }

    const rawBody = await res.text();

    if (!res.ok) {
      this.logger.error(
        `Cloudflare direct upload rejected: status=${res.status} body=${rawBody.slice(0, 500)}`,
      );
      throw new BadGatewayException('Failed to get Cloudflare upload URL');
    }

    let data: { success: boolean; result?: { uploadURL: string; uid: string }; errors?: unknown };
    try {
      data = JSON.parse(rawBody) as { success: boolean; result?: { uploadURL: string; uid: string }; errors?: unknown };
    } catch {
      this.logger.error(`Cloudflare returned invalid JSON: ${rawBody.slice(0, 500)}`);
      throw new BadGatewayException('Cloudflare returned invalid upload response');
    }

    if (!data.success || !data.result) {
      this.logger.error(
        `Cloudflare returned unsuccessful upload response: ${JSON.stringify(data.errors ?? data).slice(0, 500)}`,
      );
      throw new BadGatewayException('Cloudflare returned unsuccessful response');
    }

    return { uploadURL: data.result.uploadURL, uid: data.result.uid };
  }

  async enableVideoDownloads(streamUid: string): Promise<boolean> {
    const base = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/${streamUid}`;

    // POST /downloads generates the MP4
    const res = await fetch(`${base}/downloads`, {
      method: 'POST',
      headers: this.headers,
    });

    if (res.ok) {
      const data = await res.json() as { success: boolean };
      if (data.success) return true;
    }

    // Fallback: PATCH video to mark as downloadable
    const patch = await fetch(base, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify({ downloadable: true }),
    });

    if (patch.ok) {
      const data = await patch.json() as { success: boolean };
      return data.success === true;
    }

    return false;
  }
}
