import { Module } from '@nestjs/common';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';
import { FeedWarmService } from './feed-warm.service';
import { ReelsAiService } from './reels-ai.service';
import { AuthModule } from '../auth/auth.module';
import { CommentsModule } from '../comments/comments.module';

@Module({
  imports: [AuthModule, CommentsModule],
  controllers: [FeedController],
  providers: [FeedService, FeedWarmService, ReelsAiService],
  exports: [FeedService, FeedWarmService, ReelsAiService],
})
export class FeedModule {}

