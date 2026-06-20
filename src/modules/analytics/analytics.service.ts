import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RedisService } from '../../core/redis/redis.service';
import { SupabaseService } from '../../core/supabase/supabase.service';

type MonetizationRequirementSummary = {
  followersRequired: number;
  followersCurrent: number;
  videosRequired: number;
  videosCurrent: number;
  views30dRequired: number;
  views30dCurrent: number;
  payoutMethodConnected: boolean;
  isVerified: boolean;
};

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly monetizationFollowersRequirement = 1000;
  private readonly monetizationVideosRequirement = 10;
  private readonly monetizationViews30dRequirement = 500000;
  private readonly grossCpmTzs = 22;
  private readonly creatorShareRate = 0.5;

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
      await this.redisService.del(`analytics:monetization:${userId}`);
    }
    if (postId) {
      await this.redisService.del(`analytics:post:${postId}`);
    }
  }

  async getCreatorMonetizationSummary(userId: string) {
    const cacheKey = `analytics:monetization:${userId}`;

    return this.redisService.getOrSet(
      cacheKey,
      async () => this.buildMonetizationSummary(userId),
      300,
    );
  }

  async applyForCreatorMonetization(userId: string) {
    const client = this.supabaseService.getClient();
    const summary = await this.buildMonetizationSummary(userId);

    try {
      const now = new Date().toISOString();
      const payload = {
        user_id: userId,
        status: 'pending',
        applied_at: now,
        updated_at: now,
        last_snapshot: {
          followers: summary.requirements.followersCurrent,
          public_videos: summary.requirements.videosCurrent,
          views_30d: summary.requirements.views30dCurrent,
          payout_connected: summary.requirements.payoutMethodConnected,
        },
      };

      const { error } = await client
        .from('creator_monetization_applications')
        .upsert(payload, { onConflict: 'user_id' });

      if (error) throw error;

      const { error: statusError } = await client
        .from('creator_monetization_status')
        .upsert(
          {
            user_id: userId,
            application_status: 'pending',
            is_active: false,
            updated_at: now,
            last_checked_at: now,
          },
          { onConflict: 'user_id' },
        );

      if (statusError) throw statusError;

      await this.invalidateCache(userId);

      return {
        applied: true,
        applicationStatus: 'pending',
        summary: await this.buildMonetizationSummary(userId),
      };
    } catch (error: any) {
      if (this.isMissingRelationError(error)) {
        this.logger.warn(
          'Monetization apply requested before DB migration. Run monetization migration first.',
        );
      }
      throw error;
    }
  }

  @Cron('0 0 6 * * *')
  async syncCreatorMonetizationStatuses() {
    const client = this.supabaseService.getClient();
    try {
      const { data, error } = await client
        .from('creator_monetization_applications')
        .select('user_id, status')
        .in('status', ['pending', 'needs_requirements']);

      if (error) throw error;

      for (const row of data || []) {
        const userId = row.user_id as string;
        const summary = await this.buildMonetizationSummary(userId);
        const now = new Date().toISOString();

        const eligible = summary.eligibility.isEligible;
        const applicationStatus = eligible ? 'approved' : 'needs_requirements';

        await client
          .from('creator_monetization_applications')
          .update({
            status: applicationStatus,
            updated_at: now,
            reviewed_at: eligible ? now : null,
            approved_at: eligible ? now : null,
            last_snapshot: {
              followers: summary.requirements.followersCurrent,
              public_videos: summary.requirements.videosCurrent,
              views_30d: summary.requirements.views30dCurrent,
              payout_connected: summary.requirements.payoutMethodConnected,
            },
          })
          .eq('user_id', userId);

        await client
          .from('creator_monetization_status')
          .upsert(
            {
              user_id: userId,
              application_status: applicationStatus,
              is_active: eligible,
              activated_at: eligible ? now : null,
              approved_at: eligible ? now : null,
              last_checked_at: now,
              updated_at: now,
            },
            { onConflict: 'user_id' },
          );

        await this.invalidateCache(userId);
      }
    } catch (error: any) {
      if (this.isMissingRelationError(error)) {
        this.logger.warn(
          'Monetization cron skipped because monetization tables are not created yet.',
        );
        return;
      }
      this.logger.error(`Monetization approval cron failed: ${error?.message || error}`);
    }
  }

  @Cron('0 10 6 * * *')
  async snapshotCreatorMonetizationEarnings() {
    const client = this.supabaseService.getClient();
    try {
      const { data: activeRows, error } = await client
        .from('creator_monetization_status')
        .select('user_id')
        .eq('is_active', true);

      if (error) throw error;

      const now = new Date();
      const dayStart = new Date(now);
      dayStart.setDate(dayStart.getDate() - 1);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      for (const row of activeRows || []) {
        const userId = row.user_id as string;
        const summary = await this.buildMonetizationSummary(userId, {
          windowStart: dayStart,
          windowEnd: dayEnd,
          bypassCacheTables: true,
        });

        const { error: insertError } = await client
          .from('creator_daily_monetization_earnings')
          .upsert(
            {
              user_id: userId,
              earning_date: dayStart.toISOString().slice(0, 10),
              qualified_impressions: summary.window.impressions,
              engagement_rate: summary.window.engagementRate,
              gross_cpm_tzs: summary.payout.grossCpmTzs,
              creator_share_rate: summary.payout.creatorShareRate,
              bonus_multiplier: summary.payout.bonusMultiplier,
              effective_creator_cpm_tzs: summary.payout.effectiveCreatorCpmTzs,
              gross_revenue_tzs: summary.window.grossRevenueTzs,
              creator_earnings_tzs: summary.window.creatorEarningsTzs,
              platform_earnings_tzs: summary.window.platformEarningsTzs,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,earning_date' },
          );

        if (insertError) throw insertError;

        await this.invalidateCache(userId);
      }
    } catch (error: any) {
      if (this.isMissingRelationError(error)) {
        this.logger.warn(
          'Monetization earnings cron skipped because monetization tables are not created yet.',
        );
        return;
      }
      this.logger.error(`Monetization earnings cron failed: ${error?.message || error}`);
    }
  }

  private async buildMonetizationSummary(
    userId: string,
    options?: {
      windowStart?: Date;
      windowEnd?: Date;
      bypassCacheTables?: boolean;
    },
  ) {
    const client = this.supabaseService.getClient();
    const windowStart = options?.windowStart ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const windowEnd = options?.windowEnd ?? new Date();

    const [profileResult, postsResult, payoutResult, statusResult, applicationResult] =
      await Promise.all([
        client
          .from('users')
          .select('id, username, full_name, profile_image_url, followers_count, is_verified')
          .eq('id', userId)
          .maybeSingle(),
        client
          .from('posts')
          .select(
            'id, post_type, created_at, views_count, likes_count, comments_count, shares_count, saves_count, is_public, video_url, stream_uid, thumbnail_url',
          )
          .eq('user_id', userId)
          .eq('is_draft', false)
          .order('created_at', { ascending: false }),
        client
          .from('user_payout_methods')
          .select('provider, phone, full_name')
          .eq('user_id', userId)
          .maybeSingle(),
        client
          .from('creator_monetization_status')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle()
          .then((res) => (res.error && this.isMissingRelationError(res.error) ? { data: null } : res)),
        client
          .from('creator_monetization_applications')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle()
          .then((res) => (res.error && this.isMissingRelationError(res.error) ? { data: null } : res)),
      ]);

    const profile = (profileResult.data || {}) as any;
    const payoutMethod = payoutResult.data || null;
    const status = (statusResult as any)?.data || null;
    const application = (applicationResult as any)?.data || null;
    const posts = ((postsResult.data as any[]) || [])
      .map((post) => ({ ...post }))
      .filter((post) => post.is_public !== false)
      .filter((post) => this.isVideoPost(post));

    const followersCurrent = Number(profile.followers_count || 0);
    const videosCurrent = posts.length;
    const isVerified = Boolean(profile.is_verified);

    // Fetch actual view events from the last 30 days across ALL user posts.
    // Previously this summed views_count on posts created in the last 30 days,
    // which excluded any views on older posts and massively undercounted.
    const postIds = posts.map((post) => post.id).filter(Boolean);
    let windowViews: any[] = [];
    if (postIds.length > 0) {
      const { data: views, error: viewsError } = await client
        .from('post_views')
        .select('post_id, viewed_at')
        .in('post_id', postIds)
        .gte('viewed_at', windowStart.toISOString())
        .lte('viewed_at', windowEnd.toISOString());

      if (viewsError) {
        // Table may not exist yet — degrade gracefully instead of crashing
        this.logger.warn(`post_views query failed (table may not exist): ${viewsError.message}`);
        windowViews = [];
      } else {
        windowViews = views || [];
      }
    }

    const windowImpressions = windowViews.length;
    // Use the window view count (actual events in last 30 days) for the requirement.
    const views30dCurrent = windowImpressions;

    const requirements: MonetizationRequirementSummary = {
      followersRequired: this.monetizationFollowersRequirement,
      followersCurrent,
      videosRequired: this.monetizationVideosRequirement,
      videosCurrent,
      views30dRequired: this.monetizationViews30dRequirement,
      views30dCurrent,
      payoutMethodConnected: Boolean(payoutMethod),
      isVerified,
    };

    const isEligible =
      followersCurrent >= this.monetizationFollowersRequirement &&
      videosCurrent >= this.monetizationVideosRequirement &&
      views30dCurrent >= this.monetizationViews30dRequirement &&
      Boolean(payoutMethod) &&
      isVerified;
    const lifetimeImpressions = posts.reduce(
      (sum, post) => sum + Number(post.views_count || 0),
      0,
    );
    const engagementScore = posts.reduce(
      (sum, post) =>
        sum +
        Number(post.likes_count || 0) +
        Number(post.comments_count || 0) * 3 +
        Number(post.shares_count || 0) * 4 +
        Number(post.saves_count || 0) * 2,
      0,
    );
    const engagementRate =
      lifetimeImpressions > 0 ? engagementScore / lifetimeImpressions : 0;
    const bonusMultiplier = this.resolveBonusMultiplier(engagementRate);
    const effectiveCreatorCpmTzs =
      this.grossCpmTzs * this.creatorShareRate * bonusMultiplier;
    const grossRevenueTzs = Number(
      ((windowImpressions / 1000) * this.grossCpmTzs).toFixed(2),
    );
    const creatorEarningsTzs = Number(
      ((windowImpressions / 1000) * effectiveCreatorCpmTzs).toFixed(2),
    );
    const platformEarningsTzs = Number(
      (grossRevenueTzs - creatorEarningsTzs).toFixed(2),
    );
    const readinessProgress =
      [
        Math.min(1, followersCurrent / this.monetizationFollowersRequirement),
        Math.min(1, videosCurrent / this.monetizationVideosRequirement),
        Math.min(1, views30dCurrent / this.monetizationViews30dRequirement),
        payoutMethod ? 1 : 0,
      ].reduce((a, b) => a + b, 0) / 4;

    const topPosts = posts
      .map((post) => {
        const impressions = Number(post.views_count || 0);
        const postEngagementScore =
          Number(post.likes_count || 0) +
          Number(post.comments_count || 0) * 3 +
          Number(post.shares_count || 0) * 4 +
          Number(post.saves_count || 0) * 2;
        const postEngagementRate =
          impressions > 0 ? postEngagementScore / impressions : 0;
        const postBonus = this.resolveBonusMultiplier(postEngagementRate);
        const estimatedEarningsTzs = Number(
          ((impressions / 1000) * this.grossCpmTzs * this.creatorShareRate * postBonus).toFixed(2),
        );
        return {
          postId: post.id,
          impressions,
          likes: Number(post.likes_count || 0),
          comments: Number(post.comments_count || 0),
          shares: Number(post.shares_count || 0),
          saves: Number(post.saves_count || 0),
          thumbnailUrl: post.thumbnail_url || null,
          postType: post.post_type || 'video',
          estimatedEarningsTzs,
          engagementRate: Number((postEngagementRate * 100).toFixed(2)),
        };
      })
      .sort((a, b) => b.estimatedEarningsTzs - a.estimatedEarningsTzs)
      .slice(0, 5);

    return {
      profile: {
        id: profile.id || userId,
        username: profile.username || null,
        fullName: profile.full_name || null,
        profileImageUrl: profile.profile_image_url || null,
      },
      requirements,
      eligibility: {
        isEligible,
        readinessProgress: Number(readinessProgress.toFixed(4)),
        applicationStatus: application?.status || status?.application_status || 'not_applied',
        isActive: Boolean(status?.is_active),
        activatedAt: status?.activated_at || null,
      },
      payout: {
        grossCpmTzs: this.grossCpmTzs,
        creatorShareRate: this.creatorShareRate,
        bonusMultiplier,
        effectiveCreatorCpmTzs: Number(effectiveCreatorCpmTzs.toFixed(2)),
        payoutMethod,
      },
      lifetime: {
        impressions: lifetimeImpressions,
        grossRevenueTzs: Number(
          ((lifetimeImpressions / 1000) * this.grossCpmTzs).toFixed(2),
        ),
        creatorEarningsTzs: Number(
          ((lifetimeImpressions / 1000) * effectiveCreatorCpmTzs).toFixed(2),
        ),
      },
      window: {
        start: windowStart.toISOString(),
        end: windowEnd.toISOString(),
        impressions: windowImpressions,
        engagementRate: Number((engagementRate * 100).toFixed(2)),
        grossRevenueTzs,
        creatorEarningsTzs,
        platformEarningsTzs,
      },
      topPosts,
    };
  }

  private resolveBonusMultiplier(engagementRate: number) {
    if (engagementRate >= 0.06) return 1.2;
    if (engagementRate >= 0.03) return 1.1;
    return 1.0;
  }

  private isVideoPost(post: any) {
    const postType = String(post.post_type || '').toLowerCase();
    return (
      postType === 'video' ||
      postType === 'reel' ||
      Boolean(post.video_url) ||
      Boolean(post.stream_uid)
    );
  }

  private isMissingRelationError(error: any) {
    return error?.code === '42P01';
  }
}
