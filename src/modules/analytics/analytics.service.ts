import { Injectable } from '@nestjs/common';
import { RedisService } from '../../core/redis/redis.service';
import { SupabaseService } from '../../core/supabase/supabase.service';

@Injectable()
export class AnalyticsService {
  constructor(
    private redisService: RedisService,
    private supabaseService: SupabaseService,
  ) {}

  /**
   * Get user analytics summary
   */
  async getUserAnalytics(userId: string) {
    const cacheKey = `analytics:user:${userId}`;

    return this.redisService.getOrSet(
      cacheKey,
      async () => {
        const client = this.supabaseService.getClient();

        // Get user stats in parallel
        const [postsResult, followersResult, followingResult, viewsResult] = await Promise.all([
          client.from('posts').select('id', { count: 'exact' }).eq('user_id', userId),
          client.from('follows').select('id', { count: 'exact' }).eq('following_id', userId),
          client.from('follows').select('id', { count: 'exact' }).eq('follower_id', userId),
          client.from('post_views').select('id', { count: 'exact' }).eq('user_id', userId),
        ]);

        // Get engagement stats
        const { data: posts } = await client
          .from('posts')
          .select('likes_count, comments_count, views_count')
          .eq('user_id', userId);

        const totalLikes = posts?.reduce((sum, p) => sum + (p.likes_count || 0), 0) || 0;
        const totalComments = posts?.reduce((sum, p) => sum + (p.comments_count || 0), 0) || 0;
        const totalViews = posts?.reduce((sum, p) => sum + (p.views_count || 0), 0) || 0;

        return {
          postsCount: postsResult.count || 0,
          followersCount: followersResult.count || 0,
          followingCount: followingResult.count || 0,
          totalLikes,
          totalComments,
          totalViews,
          avgEngagementRate: posts?.length
            ? ((totalLikes + totalComments) / totalViews * 100).toFixed(2)
            : 0,
        };
      },
      300, // Cache for 5 minutes
    );
  }

  /**
   * Get post analytics
   */
  async getPostAnalytics(postId: string) {
    const cacheKey = `analytics:post:${postId}`;

    return this.redisService.getOrSet(
      cacheKey,
      async () => {
        const client = this.supabaseService.getClient();

        const { data: post } = await client
          .from('posts')
          .select('likes_count, comments_count, views_count, reposts_count, saves_count, created_at')
          .eq('id', postId)
          .single();

        if (!post) return null;

        // Calculate engagement rate
        const engagementRate = post.views_count > 0
          ? ((post.likes_count + post.comments_count + post.reposts_count) / post.views_count * 100).toFixed(2)
          : 0;

        return {
          ...post,
          engagementRate,
        };
      },
      60, // Cache for 1 minute
    );
  }

  /**
   * Get platform-wide analytics (admin only)
   */
  async getPlatformAnalytics() {
    const cacheKey = 'analytics:platform';

    return this.redisService.getOrSet(
      cacheKey,
      async () => {
        const client = this.supabaseService.getClient();

        const [usersResult, postsResult, liveResult] = await Promise.all([
          client.from('users').select('id', { count: 'exact' }),
          client.from('posts').select('id', { count: 'exact' }),
          client.from('live_sessions').select('id', { count: 'exact' }).eq('status', 'live'),
        ]);

        // Get online users count from Redis
        const onlineCount = await this.redisService.scard('online_users');

        return {
          totalUsers: usersResult.count || 0,
          totalPosts: postsResult.count || 0,
          activeLives: liveResult.count || 0,
          onlineUsers: onlineCount,
        };
      },
      60, // Cache for 1 minute
    );
  }

  /**
   * Invalidate analytics cache
   */
  async invalidateCache(userId?: string, postId?: string) {
    if (userId) {
      await this.redisService.del(`analytics:user:${userId}`);
    }
    if (postId) {
      await this.redisService.del(`analytics:post:${postId}`);
    }
  }
}

