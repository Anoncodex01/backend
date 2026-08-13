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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AuthGuard } from '../auth/guards/auth.guard';
import { MediaService } from './media.service';
import { MigrationService } from './migration.service';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { IsOptional, IsString, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

// Multipart form sends booleans as strings ('true'/'false').
// enableImplicitConversion uses Boolean() which turns 'false' → true, so we need explicit transform.
const BoolTransform = () => Transform(({ value }) => value === true || value === 'true' || value === '1');

class UploadVideoDto {
  @IsOptional() @IsString() caption?: string;
  @IsOptional() @IsString() locationName?: string;
  @IsOptional() @IsString() durationSeconds?: string;
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
  ) {}

  /**
   * POST /v1/media/upload-video
   * Receives video from phone, saves to disk, queues FFmpeg encoding → R2 upload
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
      limits: { fileSize: 300 * 1024 * 1024 }, // 300MB max
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

    const supabase = this.supabaseService.getClient();

    // Create post record immediately with processing status
    const { data: post, error } = await supabase
      .from('posts')
      .insert({
        user_id: userId,
        post_type: 'video',
        caption: dto.caption || null,
        location_name: dto.locationName || null,
        is_public: dto.isPublic !== false,   // default true if omitted
        allow_comments: dto.allowComments !== false,
        allow_downloads: dto.allowDownloads !== false,
        is_draft: dto.isDraft === true,      // default false if omitted
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

    // Queue encoding job
    const jobId = await this.mediaService.addVideoJob({
      inputPath: file.path,
      postId: post.id,
      userId,
      originalFilename: file.originalname,
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

  /**
   * GET /v1/media/job/:jobId
   * Poll for encoding job status
   */
  @Get('job/:jobId')
  @UseGuards(AuthGuard)
  async getJobStatus(@Param('jobId') jobId: string) {
    const status = await this.mediaService.getJobStatus(jobId);
    if (!status) throw new NotFoundException('Job not found');
    return { success: true, data: status };
  }

  /**
   * POST /v1/media/migrate
   * Admin: start migration of old Cloudflare Stream videos to R2
   */
  @Post('migrate')
  @UseGuards(AuthGuard)
  async startMigration(@Body() body: { batchSize?: number }) {
    await this.migrationService.startMigration(body.batchSize ?? 4);
    return { success: true, message: 'Migration started in background' };
  }

  /**
   * GET /v1/media/migrate/progress
   * Check migration progress
   */
  @Get('migrate/progress')
  @UseGuards(AuthGuard)
  getMigrationProgress() {
    return { success: true, data: this.migrationService.getProgress() };
  }
}
