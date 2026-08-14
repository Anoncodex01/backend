import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { SupabaseModule } from '../core/supabase/supabase.module';
import { RedisModule } from '../core/redis/redis.module';
import { MediaService } from '../modules/media/media.service';
import { R2Service } from '../modules/media/r2.service';
import { FfmpegService } from '../modules/media/ffmpeg.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ScheduleModule.forRoot(),
    RedisModule,
    SupabaseModule,
  ],
  providers: [MediaService, R2Service, FfmpegService],
})
export class WorkerModule {}
