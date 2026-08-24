import { Module } from '@nestjs/common';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';
import { FeedWarmService } from './feed-warm.service';
import { AuthModule } from '../auth/auth.module';
import { CommentsModule } from '../comments/comments.module';

@Module({
  imports: [AuthModule, CommentsModule],
  controllers: [FeedController],
  providers: [FeedService, FeedWarmService],
  exports: [FeedService, FeedWarmService],
})
export class FeedModule {}

