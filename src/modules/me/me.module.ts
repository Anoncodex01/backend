import { Module } from '@nestjs/common';
import { RedisModule } from '../../core/redis/redis.module';
import { SupabaseModule } from '../../core/supabase/supabase.module';
import { AuthModule } from '../auth/auth.module';
import { FeedModule } from '../feed/feed.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [RedisModule, SupabaseModule, AuthModule, FeedModule],
  controllers: [MeController],
  providers: [MeService],
  exports: [MeService],
})
export class MeModule {}
