import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PostsService } from './posts.service';
import { AuthGuard } from '../auth/guards/auth.guard';

class UploadUrlDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3600)
  maxDurationSeconds?: number;
}

class TusUploadUrlDto {
  @IsInt()
  @Min(1)
  fileSizeBytes: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3600)
  maxDurationSeconds?: number;
}

@Controller('posts')
export class PostsController {
  constructor(private postsService: PostsService) {}

  /**
   * POST /v1/posts/upload-url
   * Returns a one-time Cloudflare direct-upload URL (multipart POST flow).
   * The API token never leaves the server.
   */
  @Post('upload-url')
  @UseGuards(AuthGuard)
  async getUploadUrl(@Body() dto: UploadUrlDto) {
    const result = await this.postsService.getVideoUploadUrl(dto.maxDurationSeconds ?? 300);
    return { success: true, data: result };
  }

  /**
   * POST /v1/posts/tus-upload-url
   * Creates a TUS resumable upload slot on Cloudflare Stream.
   * Returns { tusUrl, uid } — Flutter PATCHes chunks directly to Cloudflare.
   * Supports resume: if upload breaks, Flutter HEAD the tusUrl to get current offset.
   */
  @Post('tus-upload-url')
  @UseGuards(AuthGuard)
  async getTusUploadUrl(@Body() dto: TusUploadUrlDto) {
    const result = await this.postsService.getTusUploadUrl(
      dto.fileSizeBytes,
      dto.maxDurationSeconds ?? 300,
    );
    return { success: true, data: result };
  }

  /**
   * POST /v1/posts/:uid/enable-downloads
   * Enables MP4 download generation for an existing stream.
   */
  @Post(':uid/enable-downloads')
  @UseGuards(AuthGuard)
  async enableDownloads(@Param('uid') uid: string) {
    const ok = await this.postsService.enableVideoDownloads(uid);
    return { success: ok };
  }
}
