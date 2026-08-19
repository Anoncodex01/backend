import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [StoriesController],
  providers: [StoriesService],
})
export class StoriesModule {}
