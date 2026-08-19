import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { FfmpegService } from '../media/ffmpeg.service';
import { R2Service } from '../media/r2.service';

export interface StoryUploadResult {
  url: string;
  thumbnailUrl?: string;
}

@Injectable()
export class StoriesService {
  private readonly logger = new Logger(StoriesService.name);

  constructor(
    private readonly r2Service: R2Service,
    private readonly ffmpegService: FfmpegService,
  ) {}

  async uploadImage(userId: string, filePath: string, mimeType: string): Promise<string> {
    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    const key = `stories/${userId}/${Date.now()}.${ext}`;
    try {
      return await this.r2Service.uploadFile(key, filePath, mimeType);
    } finally {
      fs.unlink(filePath, () => {});
    }
  }

  async uploadVideo(
    userId: string,
    filePath: string,
    mimeType: string,
  ): Promise<StoryUploadResult> {
    const ext = mimeType === 'video/quicktime' ? 'mov' : mimeType === 'video/webm' ? 'webm' : 'mp4';
    const stamp = Date.now();
    const key = `stories/${userId}/${stamp}.${ext}`;
    const thumbKey = `stories/${userId}/${stamp}_thumb.jpg`;
    const thumbPath = path.join('/tmp/whapvibez-uploads', `${stamp}_thumb.jpg`);

    let thumbnailUrl: string | undefined;
    try {
      try {
        await this.ffmpegService.extractThumbnail(filePath, thumbPath);
        thumbnailUrl = await this.r2Service.uploadFile(thumbKey, thumbPath, 'image/jpeg');
      } catch (error) {
        this.logger.warn(`Story thumbnail generation failed: ${(error as Error).message}`);
      }

      const url = await this.r2Service.uploadFile(key, filePath, mimeType);
      return { url, thumbnailUrl };
    } finally {
      fs.unlink(filePath, () => {});
      fs.unlink(thumbPath, () => {});
    }
  }

  async deleteFile(key: string): Promise<void> {
    await this.r2Service.deleteFile(key);
  }
}
