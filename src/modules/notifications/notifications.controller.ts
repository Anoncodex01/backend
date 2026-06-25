import {
  Controller,
  Post,
  Body,
  UseGuards,
  Headers,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

export class SendNotificationDto {
  @IsString()
  userId: string;
  @IsString()
  type: string;
  @IsString()
  title: string;
  @IsString()
  body: string;
  @IsOptional()
  @IsString()
  actorId?: string;
  @IsOptional()
  @IsString()
  actorUsername?: string;
  @IsOptional()
  @IsString()
  actorAvatar?: string;
  @IsOptional()
  @IsObject()
  data?: Record<string, any>;
  @IsOptional()
  @IsString()
  imageUrl?: string;
}

export class LiveStartNotificationDto {
  @IsString()
  liveId: string;
  @IsOptional()
  @IsString()
  channelName?: string;
  @IsOptional()
  @IsString()
  title?: string;
}

export class NewPostNotificationDto {
  @IsString()
  postId: string;
  @IsString()
  postType: string; // 'video' | 'image'
  @IsOptional()
  @IsString()
  caption?: string;
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;
}

export class MessageNotificationDto {
  @IsString()
  recipientId: string;
  @IsString()
  senderName: string;
  @IsString()
  messagePreview: string;
  @IsString()
  conversationId: string;
  @IsString()
  messageId: string;
}

export class AdminBroadcastNotificationDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userIds?: string[];

  @IsOptional()
  @IsString()
  type?: string;

  @IsString()
  title: string;

  @IsString()
  body: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  target?: string;

  @IsOptional()
  @IsString()
  userId?: string;
}

@Controller('notifications')
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  /**
   * POST /v1/notifications/broadcast
   * Admin-only broadcast to selected users. Used by the admin panel.
   */
  @Post('broadcast')
  async sendAdminBroadcastNotification(
    @Headers('x-admin-secret') adminSecret: string | undefined,
    @Body() dto: AdminBroadcastNotificationDto,
  ) {
    const result = await this.notificationsService.sendAdminBroadcastNotification(
      adminSecret,
      dto,
    );

    return {
      success: true,
      data: result,
    };
  }

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

  @Post('message')
  @UseGuards(AuthGuard)
  async sendMessageNotification(
    @CurrentUser() senderId: string,
    @Body() dto: MessageNotificationDto,
  ) {
    const result = await this.notificationsService.sendMessageNotification({
      recipientId: dto.recipientId,
      senderId,
      senderName: dto.senderName,
      messagePreview: dto.messagePreview,
      conversationId: dto.conversationId,
      messageId: dto.messageId,
    });

    return { success: true, data: result };
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

  /**
   * POST /v1/notifications/live-start
   * Notify followers when the authenticated user starts a live session.
   */
  @Post('live-start')
  @UseGuards(AuthGuard)
  async sendLiveStartNotification(
    @CurrentUser() userId: string,
    @Body() dto: LiveStartNotificationDto,
  ) {
    const result = await this.notificationsService.sendLiveStartNotification({
      hostId: userId,
      liveId: dto.liveId,
      channelName: dto.channelName,
      title: dto.title,
    });

    return {
      success: true,
      data: result,
    };
  }

  /**
   * POST /v1/notifications/new-post
   * Notify followers when the authenticated user publishes a new post.
   * Fire-and-forget from the client — fan-out is handled server-side.
   */
  @Post('new-post')
  @UseGuards(AuthGuard)
  async sendNewPostNotification(
    @CurrentUser() userId: string,
    @Body() dto: NewPostNotificationDto,
  ) {
    // Run fan-out in the background so the client doesn't wait for it
    this.notificationsService
      .sendNewPostNotification({
        posterId: userId,
        postId: dto.postId,
        postType: dto.postType,
        caption: dto.caption,
        thumbnailUrl: dto.thumbnailUrl,
      })
      .catch((err) => console.error('new-post notification fan-out failed:', err));

    return { success: true };
  }
}
