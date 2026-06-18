import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PostsService {
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
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/direct_upload`;

    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        maxDurationSeconds,
        downloadable: true,
        meta: { name: 'WhapVibez Upload' },
      }),
    });

    if (!res.ok) {
      throw new InternalServerErrorException('Failed to get Cloudflare upload URL');
    }

    const data = await res.json() as { success: boolean; result?: { uploadURL: string; uid: string } };
    if (!data.success || !data.result) {
      throw new InternalServerErrorException('Cloudflare returned unsuccessful response');
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
