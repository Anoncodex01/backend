import {
  Controller,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

class SendNotificationDto {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}

@Controller('notifications')
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  /**
   * POST /v1/notifications/send
   * Send a push notification (internal use)
   */
  @Post('send')
  @UseGuards(AuthGuard)
  async sendNotification(@Body() dto: SendNotificationDto) {
    const result = await this.notificationsService.sendPushNotification(dto);

    return {
      success: true,
      data: result,
    };
  }

  /**
   * POST /v1/notifications/like
   * Trigger like notification
   */
  @Post('like')
  @UseGuards(AuthGuard)
  async sendLikeNotification(
    @CurrentUser() userId: string,
    @Body() dto: { postId: string; postOwnerId: string; likerName: string },
  ) {
    await this.notificationsService.sendLikeNotification({
      ...dto,
      likerId: userId,
    });

    return { success: true };
  }

  /**
   * POST /v1/notifications/comment
   * Trigger comment notification
   */
  @Post('comment')
  @UseGuards(AuthGuard)
  async sendCommentNotification(
    @CurrentUser() userId: string,
    @Body() dto: {
      postId: string;
      postOwnerId: string;
      commenterName: string;
      commentPreview: string;
    },
  ) {
    await this.notificationsService.sendCommentNotification({
      ...dto,
      commenterId: userId,
    });

    return { success: true };
  }

  /**
   * POST /v1/notifications/follow
   * Trigger follow notification
   */
  @Post('follow')
  @UseGuards(AuthGuard)
  async sendFollowNotification(
    @CurrentUser() userId: string,
    @Body() dto: { followedUserId: string; followerName: string },
  ) {
    await this.notificationsService.sendFollowNotification({
      ...dto,
      followerId: userId,
    });

    return { success: true };
  }
}

