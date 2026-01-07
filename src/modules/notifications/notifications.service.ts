import { Injectable } from '@nestjs/common';
import { RedisService } from '../../core/redis/redis.service';
import { FirebaseService } from '../../core/firebase/firebase.service';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { AuthService } from '../auth/auth.service';

interface NotificationPayload {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}

@Injectable()
export class NotificationsService {
  constructor(
    private redisService: RedisService,
    private firebaseService: FirebaseService,
    private supabaseService: SupabaseService,
    private authService: AuthService,
  ) {}

  /**
   * Send push notification to user
   */
  async sendPushNotification(payload: NotificationPayload) {
    try {
      // Get user's FCM tokens
      const tokens = await this.authService.getFcmTokens(payload.userId);

      if (tokens.length === 0) {
        console.log(`No FCM tokens for user ${payload.userId}`);
        return { sent: false, reason: 'no_tokens' };
      }

      // Send to all devices
      const response = await this.firebaseService.sendMulticastNotification({
        tokens,
        title: payload.title,
        body: payload.body,
        data: {
          type: payload.type,
          ...Object.fromEntries(
            Object.entries(payload.data || {}).map(([k, v]) => [k, String(v)]),
          ),
        },
      });

      // Store notification in database
      await this.supabaseService.createNotification(payload);

      return {
        sent: true,
        successCount: response.successCount,
        failureCount: response.failureCount,
      };
    } catch (error) {
      console.error('Error sending push notification:', error);
      return { sent: false, error: error.message };
    }
  }

  /**
   * Send notification for like
   */
  async sendLikeNotification(data: {
    postId: string;
    postOwnerId: string;
    likerId: string;
    likerName: string;
  }) {
    // Don't notify if liking own post
    if (data.postOwnerId === data.likerId) return;

    // Debounce: check if we recently sent a like notification
    const debounceKey = `notif_debounce:like:${data.postId}:${data.likerId}`;
    const wasRecentlySent = await this.redisService.exists(debounceKey);
    if (wasRecentlySent) return;

    // Set debounce (1 hour)
    await this.redisService.set(debounceKey, '1', 3600);

    await this.sendPushNotification({
      userId: data.postOwnerId,
      type: 'like',
      title: 'New Like',
      body: `${data.likerName} liked your video`,
      data: { postId: data.postId, userId: data.likerId },
    });
  }

  /**
   * Send notification for comment
   */
  async sendCommentNotification(data: {
    postId: string;
    postOwnerId: string;
    commenterId: string;
    commenterName: string;
    commentPreview: string;
  }) {
    // Don't notify if commenting on own post
    if (data.postOwnerId === data.commenterId) return;

    await this.sendPushNotification({
      userId: data.postOwnerId,
      type: 'comment',
      title: 'New Comment',
      body: `${data.commenterName}: ${data.commentPreview.substring(0, 50)}`,
      data: { postId: data.postId, userId: data.commenterId },
    });
  }

  /**
   * Send notification for follow
   */
  async sendFollowNotification(data: {
    followedUserId: string;
    followerId: string;
    followerName: string;
  }) {
    await this.sendPushNotification({
      userId: data.followedUserId,
      type: 'follow',
      title: 'New Follower',
      body: `${data.followerName} started following you`,
      data: { userId: data.followerId },
    });
  }

  /**
   * Send notification for live stream
   */
  async sendLiveNotification(data: {
    hostId: string;
    hostName: string;
    liveId: string;
    channelName: string;
  }) {
    // Get followers of the host
    const client = this.supabaseService.getClient();
    const { data: followers, error } = await client
      .from('follows')
      .select('follower_id')
      .eq('following_id', data.hostId);

    if (error || !followers?.length) return;

    // Send to topic (more efficient for many users)
    try {
      await this.firebaseService.sendToTopic({
        topic: `user_${data.hostId}_followers`,
        title: `${data.hostName} is live!`,
        body: 'Tap to watch now',
        data: {
          type: 'live',
          liveId: data.liveId,
          channelName: data.channelName,
          hostId: data.hostId,
        },
      });
    } catch (error) {
      console.error('Error sending live notification:', error);
    }
  }

  /**
   * Send notification for message
   */
  async sendMessageNotification(data: {
    recipientId: string;
    senderId: string;
    senderName: string;
    messagePreview: string;
    conversationId: string;
  }) {
    await this.sendPushNotification({
      userId: data.recipientId,
      type: 'message',
      title: data.senderName,
      body: data.messagePreview.substring(0, 100),
      data: {
        conversationId: data.conversationId,
        senderId: data.senderId,
      },
    });
  }
}

