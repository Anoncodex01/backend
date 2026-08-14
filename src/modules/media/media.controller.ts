import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Headers,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '../auth/guards/auth.guard';
import { MediaService } from './media.service';
import { MigrationService } from './migration.service';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { RedisService } from '../../core/redis/redis.service';
import { IsOptional, IsString, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

const UPLOADS_PER_DAY = 3;
const UPLOAD_RATE_TTL_SECONDS = 24 * 60 * 60;

const BoolTransform = () => Transform(({ value }) => value === true || value === 'true' || value === '1');

function parseMultipartBool(value: unknown, defaultValue = false): boolean {
  if (value === undefined || value === null || value === '') return defaultValue;
  return value === true || value === 'true' || value === 1 || value === '1';
}

function parseHashtags(raw: unknown): string[] {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }
  const text = String(raw).trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch {
      // fall through
    }
  }
  return text.split(',').map((tag) => tag.trim()).filter(Boolean);
}

class UploadVideoDto {
  @IsOptional() @IsString() caption?: string;
  @IsOptional() @IsString() locationName?: string;
  @IsOptional() @IsString() durationSeconds?: string;
  @IsOptional() @IsString() hashtags?: string;
  @IsOptional() @IsBoolean() @BoolTransform() isPublic?: boolean;
  @IsOptional() @IsBoolean() @BoolTransform() allowComments?: boolean;
  @IsOptional() @IsBoolean() @BoolTransform() allowDownloads?: boolean;
  @IsOptional() @IsBoolean() @BoolTransform() isDraft?: boolean;
}

@Controller('media')
export class MediaController {
  constructor(
    private mediaService: MediaService,
    private migrationService: MigrationService,
    private supabaseService: SupabaseService,
    private redisService: RedisService,
    private configService: ConfigService,
  ) {}

  private assertAdminSecret(secret?: string) {
    const expected =
      this.configService.get<string>('SUPPORT_ADMIN_SECRET', '') ||
      this.configService.get<string>('ADMIN_SECRET', '');

    if (!expected || secret !== expected) {
      throw new ForbiddenException('Invalid admin secret');
    }
  }

  private async assertDailyUploadLimit(userId: string) {
    const key = `media:upload:daily:${userId}`;
    const count = await this.redisService.incr(key);
    if (count === 1) {
      await this.redisService.expire(key, UPLOAD_RATE_TTL_SECONDS);
    }
    if (count > UPLOADS_PER_DAY) {
      throw new HttpException(
        `Upload limit reached (${UPLOADS_PER_DAY} videos per 24 hours). Try again tomorrow.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * POST /v1/media/upload-video
   */
  @Post('upload-video')
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: '/tmp/whapvibez-uploads',
        filename: (_req, file, cb) => {
          cb(null, `${uuidv4()}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 300 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('video/')) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only video files are allowed'), false);
        }
      },
    }),
  )
  async uploadVideo(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadVideoDto,
    @Request() req: any,
  ) {
    if (!file) throw new BadRequestException('No video file provided');

    const userId = req.user?.sub || req.user?.id;
    if (!userId) throw new BadRequestException('User not authenticated');

    const rawBody = req.body ?? {};
    const isDraft = parseMultipartBool(rawBody.isDraft ?? dto.isDraft);
    if (!isDraft) {
      await this.assertDailyUploadLimit(userId);
    }

    const isPublic = parseMultipartBool(rawBody.isPublic ?? dto.isPublic, true);
    const allowComments = parseMultipartBool(rawBody.allowComments ?? dto.allowComments, true);
    const allowDownloads = parseMultipartBool(rawBody.allowDownloads ?? dto.allowDownloads, true);
    const hashtags = parseHashtags(rawBody.hashtags ?? dto.hashtags);

    const supabase = this.supabaseService.getClient();
    const { data: post, error } = await supabase
      .from('posts')
      .insert({
        user_id: userId,
        post_type: 'video',
        caption: dto.caption || null,
        location_name: dto.locationName || null,
        hashtags,
        is_public: isPublic,
        allow_comments: allowComments,
        allow_downloads: allowDownloads,
        is_draft: isDraft,
        duration_seconds: dto.durationSeconds ? parseInt(dto.durationSeconds, 10) : null,
        storage_type: 'r2',
        processing_status: 'processing',
        migrated_to_r2: true,
        likes_count: 0,
        comments_count: 0,
        shares_count: 0,
        saves_count: 0,
      })
      .select('id')
      .single();

    if (error || !post) {
      throw new BadRequestException(`Failed to create post: ${error?.message}`);
    }

    const jobId = await this.mediaService.addVideoJob({
      inputPath: file.path,
      postId: post.id,
      userId,
      originalFilename: file.originalname,
      isDraft,
    });

    return {
      success: true,
      data: {
        jobId,
        postId: post.id,
        status: 'processing',
        message: 'Video received. Encoding in progress...',
      },
    };
  }

  @Get('job/:jobId')
  @UseGuards(AuthGuard)
  async getJobStatus(@Param('jobId') jobId: string) {
    const status = await this.mediaService.getJobStatus(jobId);
    if (!status) throw new NotFoundException('Job not found');
    return { success: true, data: status };
  }

  /** Admin: queue depth + worker health */
  @Get('admin/queue-stats')
  async getQueueStats(@Headers('x-admin-secret') adminSecret?: string) {
    this.assertAdminSecret(adminSecret);
    const stats = await this.mediaService.getQueueStats();
    return { success: true, data: stats };
  }

  /** Admin: list posts stuck in failed encoding */
  @Get('admin/failed')
  async listFailedPosts(@Headers('x-admin-secret') adminSecret?: string) {
    this.assertAdminSecret(adminSecret);
    const data = await this.mediaService.listFailedPosts();
    return { success: true, data };
  }

  /** Admin: retry a failed encode when possible */
  @Post('admin/retry/:postId')
  async retryFailedPost(
    @Param('postId') postId: string,
    @Headers('x-admin-secret') adminSecret?: string,
  ) {
    this.assertAdminSecret(adminSecret);
    const result = await this.mediaService.retryFailedPost(postId);
    return { success: true, data: result };
  }

  @Post('migrate')
  async startMigration(
    @Body() body: { batchSize?: number },
    @Headers('x-admin-secret') adminSecret?: string,
  ) {
    this.assertAdminSecret(adminSecret);
    await this.migrationService.startMigration(body.batchSize ?? 4);
    return { success: true, message: 'Migration started in background' };
  }

  @Get('migrate/progress')
  async getMigrationProgress(@Headers('x-admin-secret') adminSecret?: string) {
    this.assertAdminSecret(adminSecret);
    return { success: true, data: this.migrationService.getProgress() };
  }
}
