import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SupabaseModule } from '../../core/supabase/supabase.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { R2Service } from './r2.service';
import { FfmpegService } from './ffmpeg.service';
import { MigrationService } from './migration.service';

@Module({
  imports: [AuthModule, SupabaseModule],
  controllers: [MediaController],
  providers: [MediaService, R2Service, FfmpegService, MigrationService],
  exports: [R2Service],
})
export class MediaModule {}
