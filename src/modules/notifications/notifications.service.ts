import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  imageUrl?: string;
  actorId?: string;
  actorUsername?: string;
  actorAvatar?: string;
  postId?: string;
  postThumbnail?: string;
  liveId?: string;
  communityId?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private redisService: RedisService,
    private firebaseService: FirebaseService,
    private supabaseService: SupabaseService,
    private authService: AuthService,
    private configService: ConfigService,
  ) {}

  private assertAdminSecret(secret?: string) {
    const expected =
      this.configService.get<string>('SUPPORT_ADMIN_SECRET', '') ||
      this.configService.get<string>('ADMIN_SECRET', '');

    if (!expected || secret !== expected) {
      throw new ForbiddenException('Invalid admin secret');
    }
  }

  /**
   * Send push notification to user
   */
  async sendPushNotification(payload: NotificationPayload) {
    try {
      // Always store notification in database first, regardless of FCM tokens
      try {
        await this.supabaseService.createNotification(payload);
      } catch (dbError) {
        console.error('Error storing notification in database:', dbError);
      }

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
        imageUrl: payload.imageUrl,
        data: {
          type: payload.type,
          ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
          ...Object.fromEntries(
            Object.entries(payload.data || {}).map(([k, v]) => [k, String(v)]),
          ),
        },
      });

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
   * Admin broadcast: store an inbox notification for every selected user and
   * send matching FCM pushes so tapping the push opens the notification inbox.
   */
  async sendAdminBroadcastNotification(
    adminSecret: string | undefined,
    data: {
      userIds: string[];
      type?: string;
      title: string;
      body: string;
      imageUrl?: string;
      productId?: string;
      target?: string;
    },
  ) {
    this.assertAdminSecret(adminSecret);

    const title = data.title?.trim();
    const body = data.body?.trim();
    const userIds = [...new Set((data.userIds || []).filter(Boolean))];
    const payloadType = data.type === 'product' ? 'product' : 'broadcast';
    // The production notifications table still has a strict CHECK constraint
    // for the `type` column. Store admin announcements as `system` inbox rows
    // while preserving the real kind in `data.type` and the push payload.
    const storedType = 'system';

    if (!title || !body) {
      throw new BadRequestException('Title and body are required');
    }
    if (userIds.length === 0) {
      throw new BadRequestException('No users matched this broadcast');
    }

    const client = this.supabaseService.getClient();
    const notificationRows = userIds.map((userId) => ({
      user_id: userId,
      type: storedType,
      title,
      body,
      actor_username: 'WhapVibez',
      post_thumbnail: data.imageUrl || null,
      data: {
        type: payloadType,
        route: 'notifications',
        target: data.target || 'all',
        ...(data.productId ? { productId: data.productId, product_id: data.productId } : {}),
        ...(data.imageUrl ? { imageUrl: data.imageUrl } : {}),
      },
      is_read: false,
    }));

    let storedCount = 0;
    for (let i = 0; i < notificationRows.length; i += 500) {
      const batch = notificationRows.slice(i, i + 500);
      const { error } = await client.from('notifications').insert(batch);
      if (error) {
        console.error('Error storing admin broadcast notifications:', error);
        throw error;
      }
      storedCount += batch.length;
    }

    const allTokens: string[] = [];
    for (let i = 0; i < userIds.length; i += 100) {
      const batchIds = userIds.slice(i, i + 100);
      const tokenBatches = await Promise.all(
        batchIds.map((userId) => this.authService.getFcmTokens(userId)),
      );
      for (const tokens of tokenBatches) {
        allTokens.push(...tokens);
      }
    }

    const uniqueTokens = [...new Set(allTokens)].filter(Boolean);
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < uniqueTokens.length; i += 500) {
      const tokens = uniqueTokens.slice(i, i + 500);
      try {
        const response = await this.firebaseService.sendMulticastNotification({
          tokens,
          title,
          body,
          imageUrl: data.imageUrl,
          data: {
            type: payloadType,
            route: 'notifications',
            target: data.target || 'all',
            title,
            body,
            ...(data.productId ? { productId: data.productId, product_id: data.productId } : {}),
            ...(data.imageUrl ? { imageUrl: data.imageUrl } : {}),
          },
        });
        successCount += response.successCount;
        failureCount += response.failureCount;
      } catch (error) {
        failureCount += tokens.length;
        console.error('Error sending admin broadcast FCM batch:', error);
      }
    }

    return {
      recipients: userIds.length,
      stored: storedCount,
      tokens: uniqueTokens.length,
      successCount,
      failureCount,
    };
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

    const actorImage = await this.getUserProfileImage(data.likerId);

    await this.sendPushNotification({
      userId: data.postOwnerId,
      type: 'like',
      title: 'New Like',
      body: `${data.likerName} liked your video`,
      imageUrl: actorImage,
      actorId: data.likerId,
      actorUsername: data.likerName,
      actorAvatar: actorImage,
      postId: data.postId,
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

    const [actorImage, actorIsVerified, postThumbnail] = await Promise.all([
      this.getUserProfileImage(data.commenterId),
      this.getUserIsVerified(data.commenterId),
      this.getPostThumbnail(data.postId),
    ]);

    await this.sendPushNotification({
      userId: data.postOwnerId,
      type: 'comment',
      title: 'New Comment',
      body: `${data.commenterName}: ${data.commentPreview.substring(0, 50)}`,
      imageUrl: actorImage,
      actorId: data.commenterId,
      actorUsername: data.commenterName,
      actorAvatar: actorImage,
      postId: data.postId,
      postThumbnail: postThumbnail ?? undefined,
      data: {
        postId: data.postId,
        userId: data.commenterId,
        actor_is_verified: actorIsVerified,
      },
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
    const actorImage = await this.getUserProfileImage(data.followerId);

    await this.sendPushNotification({
      userId: data.followedUserId,
      type: 'follow',
      title: 'New Follower',
      body: `${data.followerName} started following you`,
      imageUrl: actorImage,
      actorId: data.followerId,
      actorUsername: data.followerName,
      actorAvatar: actorImage,
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
   * Fan out a live-start notification to the host's followers.
   * This is used by the Firestore-based live flow in the mobile app, so users
   * still get FCM pushes even when the backend did not create the live session.
   */
  async sendLiveStartNotification(data: {
    hostId: string;
    liveId: string;
    channelName?: string;
    title?: string;
  }) {
    if (!data.hostId || !data.liveId) {
      return { sent: false, reason: 'missing_host_or_live_id' };
    }

    const debounceKey = `notif_debounce:live_start:${data.liveId}`;
    const wasRecentlySent = await this.redisService.exists(debounceKey);
    if (wasRecentlySent) {
      return { sent: false, reason: 'duplicate_live_start' };
    }
    await this.redisService.set(debounceKey, '1', 30 * 60);

    const client = this.supabaseService.getClient();
    const host = await this.supabaseService.getUser(data.hostId).catch(() => null);
    const hostName =
      host?.full_name || host?.username || data.title || 'Someone you follow';
    const hostAvatar = host?.profile_image_url || undefined;
    const hostIsVerified = host?.is_verified === true;
    const title = `${hostName} invited you to a live`;
    const body = (data.title?.trim().length || 0) > 0
      ? data.title!.trim()
      : 'Join now and watch live';

    const followerIds: string[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const to = from + pageSize - 1;
      const { data: rows, error } = await client
        .from('follows')
        .select('follower_id')
        .eq('following_id', data.hostId)
        .range(from, to);

      if (error) {
        console.error('Error loading live notification followers:', error);
        break;
      }

      const ids = (rows || [])
        .map((row: any) => row.follower_id)
        .filter((id: any) => typeof id === 'string' && id !== data.hostId);
      followerIds.push(...ids);

      if (!rows || rows.length < pageSize) break;
    }

    const uniqueFollowerIds = [...new Set(followerIds)];
    if (uniqueFollowerIds.length === 0) {
      return { sent: false, reason: 'no_followers' };
    }

    const notificationRows = uniqueFollowerIds.map((userId) => ({
      user_id: userId,
      type: 'live',
      title,
      body,
      actor_id: data.hostId,
      actor_username: hostName,
      actor_avatar: hostAvatar,
      live_id: data.liveId,
      data: {
        type: 'live',
        liveId: data.liveId,
        live_id: data.liveId,
        hostId: data.hostId,
        host_id: data.hostId,
        channelName: data.channelName || '',
        channel_name: data.channelName || '',
        actor_is_verified: hostIsVerified,
      },
      is_read: false,
    }));

    for (let i = 0; i < notificationRows.length; i += 500) {
      const batch = notificationRows.slice(i, i + 500);
      const { error } = await client.from('notifications').insert(batch);
      if (error) {
        console.error('Error storing live notifications:', error);
      }
    }

    const allTokens: string[] = [];
    for (let i = 0; i < uniqueFollowerIds.length; i += 100) {
      const batchIds = uniqueFollowerIds.slice(i, i + 100);
      const tokenBatches = await Promise.all(
        batchIds.map((userId) => this.authService.getFcmTokens(userId)),
      );
      for (const tokens of tokenBatches) {
        allTokens.push(...tokens);
      }
    }

    const uniqueTokens = [...new Set(allTokens)].filter(Boolean);
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < uniqueTokens.length; i += 500) {
      const tokens = uniqueTokens.slice(i, i + 500);
      try {
        const response = await this.firebaseService.sendMulticastNotification({
          tokens,
          title,
          body,
          imageUrl: hostAvatar,
          data: {
            type: 'live',
            liveId: data.liveId,
            live_id: data.liveId,
            hostId: data.hostId,
            host_id: data.hostId,
            channelName: data.channelName || '',
            channel_name: data.channelName || '',
            userId: data.hostId,
            user_id: data.hostId,
          },
        });
        successCount += response.successCount;
        failureCount += response.failureCount;
      } catch (error) {
        failureCount += tokens.length;
        console.error('Error sending live FCM batch:', error);
      }
    }

    const result = {
      sent: uniqueTokens.length > 0,
      followers: uniqueFollowerIds.length,
      tokens: uniqueTokens.length,
      successCount,
      failureCount,
    };

    console.log('📡 Live start notification result:', {
      hostId: data.hostId,
      liveId: data.liveId,
      ...result,
    });

    return result;
  }

  /**
   * Fan out a "new post" notification to the poster's followers.
   * Debounced per post so duplicate calls (e.g. retries) don't double-notify.
   */
  async sendNewPostNotification(data: {
    posterId: string;
    postId: string;
    postType: string;        // 'video' | 'image'
    caption?: string;
    thumbnailUrl?: string;
  }) {
    if (!data.posterId || !data.postId) {
      return { sent: false, reason: 'missing_poster_or_post_id' };
    }

    const debounceKey = `notif_debounce:new_post:${data.postId}`;
    const wasRecentlySent = await this.redisService.exists(debounceKey);
    if (wasRecentlySent) {
      return { sent: false, reason: 'duplicate_new_post' };
    }
    await this.redisService.set(debounceKey, '1', 60 * 60); // 1 h debounce

    const client = this.supabaseService.getClient();
    const poster = await this.supabaseService.getUser(data.posterId).catch(() => null);
    const posterName = poster?.full_name || poster?.username || 'Someone you follow';
    const posterAvatar = poster?.profile_image_url || undefined;
    const posterIsVerified = poster?.is_verified === true;

    const isVideo = data.postType === 'video';
    const title = `${posterName} posted a new ${isVideo ? 'video' : 'photo'}`;
    const body = data.caption?.trim() || (isVideo ? 'Check out this new video' : 'Check out this new post');

    // Paginate through all followers (1 000 per page)
    const followerIds: string[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const to = from + pageSize - 1;
      const { data: rows, error } = await client
        .from('follows')
        .select('follower_id')
        .eq('following_id', data.posterId)
        .range(from, to);

      if (error) {
        console.error('Error loading new-post notification followers:', error);
        break;
      }

      const ids = (rows || [])
        .map((row: any) => row.follower_id)
        .filter((id: any) => typeof id === 'string' && id !== data.posterId);
      followerIds.push(...ids);
      if (!rows || rows.length < pageSize) break;
    }

    const uniqueFollowerIds = [...new Set(followerIds)];
    if (uniqueFollowerIds.length === 0) {
      return { sent: false, reason: 'no_followers' };
    }

    // Bulk-insert notification rows in Supabase (500 per batch)
    const notificationRows = uniqueFollowerIds.map((userId) => ({
      user_id: userId,
      type: 'new_post',
      title,
      body,
      actor_id: data.posterId,
      actor_username: posterName,
      actor_avatar: posterAvatar,
      post_id: data.postId,
      post_thumbnail: data.thumbnailUrl || null,
      data: {
        type: 'new_post',
        postId: data.postId,
        post_id: data.postId,
        postType: data.postType,
        posterId: data.posterId,
        actor_is_verified: posterIsVerified,
      },
      is_read: false,
    }));

    for (let i = 0; i < notificationRows.length; i += 500) {
      const batch = notificationRows.slice(i, i + 500);
      const { error } = await client.from('notifications').insert(batch);
      if (error) {
        console.error('Error storing new-post notifications:', error);
      }
    }

    // Collect all FCM tokens (100 users at a time to avoid overloading Redis)
    const allTokens: string[] = [];
    for (let i = 0; i < uniqueFollowerIds.length; i += 100) {
      const batchIds = uniqueFollowerIds.slice(i, i + 100);
      const tokenBatches = await Promise.all(
        batchIds.map((userId) => this.authService.getFcmTokens(userId)),
      );
      for (const tokens of tokenBatches) {
        allTokens.push(...tokens);
      }
    }

    const uniqueTokens = [...new Set(allTokens)].filter(Boolean);
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < uniqueTokens.length; i += 500) {
      const tokens = uniqueTokens.slice(i, i + 500);
      try {
        const response = await this.firebaseService.sendMulticastNotification({
          tokens,
          title,
          body,
          imageUrl: data.thumbnailUrl || posterAvatar,
          data: {
            type: 'new_post',
            postId: data.postId,
            post_id: data.postId,
            postType: data.postType,
            posterId: data.posterId,
            poster_id: data.posterId,
          },
        });
        successCount += response.successCount;
        failureCount += response.failureCount;
      } catch (error) {
        failureCount += tokens.length;
        console.error('Error sending new-post FCM batch:', error);
      }
    }

    const result = {
      sent: uniqueTokens.length > 0,
      followers: uniqueFollowerIds.length,
      tokens: uniqueTokens.length,
      successCount,
      failureCount,
    };
    console.log('📢 New post notification result:', { posterId: data.posterId, postId: data.postId, ...result });
    return result;
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
    messageId?: string;
  }) {
    const actorImage = await this.getUserProfileImage(data.senderId);

    return this.sendPushNotification({
      userId: data.recipientId,
      type: 'message',
      title: data.senderName,
      body: data.messagePreview.substring(0, 100),
      imageUrl: undefined,
      actorId: data.senderId,
      actorUsername: data.senderName,
      actorAvatar: actorImage,
      data: {
        conversationId: data.conversationId,
        senderId: data.senderId,
        ...(data.messageId ? { messageId: data.messageId } : {}),
      },
    });
  }

  private async getUserProfileImage(userId: string) {
    try {
      const user = await this.supabaseService.getUser(userId);
      return user?.profile_image_url || undefined;
    } catch (_) {
      return undefined;
    }
  }

  private async getUserIsVerified(userId: string): Promise<boolean> {
    try {
      const user = await this.supabaseService.getUser(userId);
      return user?.is_verified === true;
    } catch (_) {
      return false;
    }
  }

  private async getPostThumbnail(postId: string): Promise<string | null> {
    try {
      const client = this.supabaseService.getClient();
      const { data } = await client
        .from('posts')
        .select('thumbnail_url')
        .eq('id', postId)
        .maybeSingle();
      return data?.thumbnail_url || null;
    } catch (_) {
      return null;
    }
  }
}
