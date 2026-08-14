import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SupabaseModule } from '../../core/supabase/supabase.module';
import { RedisModule } from '../../core/redis/redis.module';
import { FeedModule } from '../feed/feed.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { R2Service } from './r2.service';
import { FfmpegService } from './ffmpeg.service';
import { MigrationService } from './migration.service';

@Module({
  imports: [
    AuthModule,
    SupabaseModule,
    RedisModule,
    forwardRef(() => FeedModule),
  ],
  controllers: [MediaController],
  providers: [MediaService, R2Service, FfmpegService, MigrationService],
  exports: [MediaService, R2Service],
})
export class MediaModule {}
