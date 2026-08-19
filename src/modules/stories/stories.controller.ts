import {
  Controller,
  Post,
  Delete,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AuthGuard } from '../auth/guards/auth.guard';
import { StoriesService } from './stories.service';

@Controller('stories')
export class StoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  @Post('upload-image')
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: '/tmp/whapvibez-uploads',
        filename: (_req, file, cb) => cb(null, `${uuidv4()}${extname(file.originalname)}`),
      }),
      limits: { fileSize: 20 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only image files are allowed'), false);
        }
      },
    }),
  )
  async uploadImage(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    if (!file) throw new BadRequestException('No image file provided');
    const userId: string = req.user?.sub || req.user?.id;
    if (!userId) throw new BadRequestException('User not authenticated');

    const url = await this.storiesService.uploadImage(userId, file.path, file.mimetype);
    return { url };
  }

  @Post('upload-video')
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: '/tmp/whapvibez-uploads',
        filename: (_req, file, cb) => cb(null, `${uuidv4()}${extname(file.originalname)}`),
      }),
      limits: { fileSize: 150 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('video/')) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only video files are allowed'), false);
        }
      },
    }),
  )
  async uploadVideo(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    if (!file) throw new BadRequestException('No video file provided');
    const userId: string = req.user?.sub || req.user?.id;
    if (!userId) throw new BadRequestException('User not authenticated');

    const result = await this.storiesService.uploadVideo(userId, file.path, file.mimetype);
    return result;
  }

  @Delete('delete-file')
  @UseGuards(AuthGuard)
  async deleteFile(@Body('key') key: string, @Request() req: any) {
    if (!key?.trim()) throw new BadRequestException('key is required');
    const userId: string = req.user?.sub || req.user?.id;
    if (!userId) throw new BadRequestException('User not authenticated');

    // Only allow deleting files under the user's own prefix
    if (!key.startsWith(`stories/${userId}/`)) {
      throw new BadRequestException('Cannot delete another user\'s story file');
    }

    await this.storiesService.deleteFile(key);
    return { ok: true };
  }
}
