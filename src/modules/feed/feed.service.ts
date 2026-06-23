import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../core/redis/redis.service';
import { SupabaseService } from '../../core/supabase/supabase.service';

@Injectable()
export class FeedService {
  private feedTtl: number;
  private trendingTtl: number;
  private reelsTtl: number;

  constructor(
    private redisService: RedisService,
    private supabaseService: SupabaseService,
    private configService: ConfigService,
  ) {
    this.feedTtl = this.configService.get('CACHE_FEED_TTL', 30);
    // Reduced from 120s → 30s so newly posted videos surface faster.
    this.trendingTtl = this.configService.get('CACHE_TRENDING_TTL', 30);
    // Keep first reels page hot for longer to reduce DB pressure and cold starts.
    this.reelsTtl = this.configService.get('CACHE_REELS_TTL', 45);
  }

  /**
   * Get "For You" feed with caching
   * This dramatically reduces database load
   * Gracefully falls back to Supabase if Redis is unavailable
   */
  async getForYouFeed(options: {
    userId?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = options.limit || 20;
    const offset = options.offset || 0;
    const cacheKey = `feed:foryou:${offset}:${limit}`;

    // Get cached feed (with error handling)
    let posts: any[] | null = null;
    try {
      posts = await this.redisService.getJson<any[]>(cacheKey);
    } catch (error) {
      console.warn('Redis cache read failed, falling back to database:', error);
    }

    if (!posts) {
      // Fetch from database
      posts = await this.supabaseService.getPosts({
        limit,
        offset,
        isPublic: true,
        orderBy: 'created_at',
      });

      // Cache the result (with error handling)
      try {
      await this.redisService.setJson(cacheKey, posts, this.feedTtl);
      } catch (error) {
        console.warn('Redis cache write failed, continuing without cache:', error);
      }
    }

    // If user is logged in, enrich with their interaction status
    if (options.userId && posts && posts.length > 0) {
      posts = await this.enrichPostsWithUserStatus(posts, options.userId);
    }

    return posts || [];
  }

  /**
   * Get "Following" feed for a specific user
   */
  async getFollowingFeed(options: {
    userId: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = options.limit || 20;
    const offset = options.offset || 0;
    const cacheKey = `feed:following:${options.userId}:${offset}:${limit}`;

    // Following feed is personalized, shorter cache
    let posts: any[] | null = null;
    try {
      posts = await this.redisService.getJson<any[]>(cacheKey);
    } catch (error) {
      console.warn('Redis cache read failed, falling back to database:', error);
    }

    if (!posts) {
      posts = await this.supabaseService.getFollowingPosts(
        options.userId,
        limit,
        offset,
      );

      // Cache for shorter time (personalized content)
      try {
      await this.redisService.setJson(cacheKey, posts, 15);
      } catch (error) {
        console.warn('Redis cache write failed, continuing without cache:', error);
      }
    }

    // Enrich with user status
    if (posts && posts.length > 0) {
      posts = await this.enrichPostsWithUserStatus(posts, options.userId);
    }

    return posts || [];
  }

  /**
   * Get trending posts (cursor pagination; cache first page only)
   */
  async getTrendingFeed(options: {
    userId?: string;
    limit?: number;
    offset?: number;
    cursor?: string;
  }) {
    const limit = options.limit || 20;
    const offset = options.offset || 0;
    const cursor = options.cursor;
    const isFirstPage = !cursor && offset === 0;
    const cacheKey = 'feed:trending:page1';

    let posts: any[] | null = null;
    if (isFirstPage) {
      try {
        posts = await this.redisService.getJson<any[]>(cacheKey);
      } catch (error) {
        console.warn('Redis cache read failed, falling back to database:', error);
      }
    }

    if (!posts) {
      posts = await this.supabaseService.getTrendingPosts(limit, offset, cursor);
      if (isFirstPage) {
        try {
          await this.redisService.setJson(cacheKey, posts, this.trendingTtl);
        } catch (error) {
          console.warn('Redis cache write failed:', error);
        }
      }
    }

    if (options.userId && posts && posts.length > 0) {
      posts = await this.enrichPostsWithUserStatus(posts, options.userId);
    }

    return posts || [];
  }

  /**
   * Get profile posts (user's posts, optional video-only) – cached for profile/screen
   */
  async getProfileFeed(options: {
    profileUserId: string;
    userId?: string;
    limit?: number;
    offset?: number;
    videoOnly?: boolean;
  }) {
    const limit = options.limit || 20;
    const offset = options.offset || 0;
    const videoOnly = options.videoOnly ?? false;
    const cacheKey = `feed:profile:${options.profileUserId}:${offset}:${limit}:${videoOnly}`;

    let posts: any[] | null = null;
    try {
      posts = await this.redisService.getJson<any[]>(cacheKey);
    } catch (error) {
      console.warn('Redis profile cache read failed, falling back to database:', error);
    }

    if (!posts) {
      posts = await this.supabaseService.getUserPosts(options.profileUserId, {
        limit,
        offset,
        isPublic: true,
        videoOnly,
      });
      try {
        await this.redisService.setJson(cacheKey, posts, 60); // 1 min
      } catch (error) {
        console.warn('Redis profile cache write failed:', error);
      }
    }

    if (options.userId && posts && posts.length > 0) {
      posts = await this.enrichPostsWithUserStatus(posts, options.userId);
    }

    return posts || [];
  }

  /**
   * Get reels feed (video-only, cursor pagination; cache first page only)
   */
  async getReelsFeed(options: {
    userId?: string;
    limit?: number;
    offset?: number;
    cursor?: string;
    fresh?: boolean;
    createdAfter?: string;
    mode?: 'reels' | 'old_gems';
  }) {
    const limit = options.limit || 20;
    const offset = options.offset || 0;
    const cursor = options.cursor;
    const fresh = options.fresh === true;
    const createdAfter = options.createdAfter;
    const mode = options.mode || 'reels';
    const isFirstPage = !cursor && offset === 0 && !createdAfter;
    const cacheKey = mode === 'old_gems'
      ? `feed:reels:old_gems:page1:${limit}`
      : `feed:reels:v2:page1:${limit}`;

    let posts: any[] | null = null;
    if (isFirstPage && !fresh) {
      try {
        posts = await this.redisService.getJson<any[]>(cacheKey);
      } catch (error) {
        console.warn('Redis reels cache read failed, falling back to database:', error);
      }
    }

    if (!posts) {
      posts = mode === 'old_gems'
        ? await this.supabaseService.getOldGemsReelsPosts(limit, offset, cursor)
        : await this.supabaseService.getReelsPosts(limit, offset, cursor, createdAfter);
      if (isFirstPage && !fresh) {
        try {
          await this.redisService.setJson(cacheKey, posts, this.reelsTtl);
        } catch (error) {
          console.warn('Redis reels cache write failed:', error);
        }
      }
    }

    if (options.userId && posts && posts.length > 0) {
      posts = await this.enrichPostsWithUserStatus(posts, options.userId);
    }

    return posts || [];
  }

  /**
   * Get a single post with caching
   */
  async getPost(postId: string, userId?: string) {
    const cacheKey = `post:${postId}`;

    let post: any = null;
    try {
      post = await this.redisService.getJson<any>(cacheKey);
    } catch (error) {
      console.warn('Redis cache read failed, falling back to database:', error);
    }

    if (!post) {
      post = await this.supabaseService.getPost(postId);
      try {
      await this.redisService.setJson(cacheKey, post, 60);
      } catch (error) {
        console.warn('Redis cache write failed, continuing without cache:', error);
      }
    }

    if (userId && post) {
      const status = await this.supabaseService.getPostInteractionStatus(postId, userId);
      post = {
        ...post,
        is_liked: status.isLiked,
        is_saved: status.isSaved,
      };
    }

    return post;
  }

  /**
   * Get active stories (not expired) with user info – globally cached in Redis.
   * TTL: 45 s — short enough that new stories appear quickly.
   */
  async getActiveStories() {
    const cacheKey = 'feed:stories:active';

    let stories: any[] | null = null;
    try {
      stories = await this.redisService.getJson<any[]>(cacheKey);
    } catch (error) {
      console.warn('Redis stories cache read failed, falling back to database:', error);
    }

    if (!stories) {
      const nowIso = new Date().toISOString();
      const { data, error } = await this.supabaseService
        .getClient()
        .from('stories')
        .select('id,user_id,media_type,media_url,thumbnail_url,stream_uid,created_at,expires_at,users(id,username,full_name,profile_image_url,is_verified)')
        .gte('expires_at', nowIso)
        .order('created_at', { ascending: false })
        .limit(60);

      if (error) {
        console.error('Error fetching stories from Supabase:', error);
        return [];
      }

      stories = (data as any[]) || [];

      try {
        await this.redisService.setJson(cacheKey, stories, 45);
      } catch (cacheError) {
        console.warn('Redis stories cache write failed, continuing without cache:', cacheError);
      }
    }

    return stories;
  }

  /**
   * Invalidate stories cache (call after a new story is created or deleted)
   */
  async invalidateStoriesCache() {
    try {
      await this.redisService.del('feed:stories:active');
    } catch (error) {
      console.warn('Redis stories cache invalidation failed:', error);
    }
  }

  /**
   * Enrich posts with user's like/save status
   */
  private async enrichPostsWithUserStatus(posts: any[], userId: string) {
    const postIds = posts.map((p) => p.id);
    const statusMap = await this.supabaseService.getPostInteractionStatusBatch(
      postIds,
      userId,
    );

    return posts.map((post) => {
      const status = statusMap.get(post.id) || {
        isLiked: false,
        isSaved: false,
      };
      return {
        ...post,
        is_liked: status.isLiked,
        is_saved: status.isSaved,
      };
    });
  }

  /**
   * Invalidate feed caches (call when new post is created)
   */
  async invalidateFeedCache() {
    try {
      await this.redisService.deletePattern('feed:foryou:*');
      await this.redisService.del('feed:trending:page1');
      await this.redisService.deletePattern('feed:reels:page1:*');
      await this.redisService.deletePattern('feed:reels:old_gems:*');
    } catch (error) {
      console.warn('Redis cache invalidation failed:', error);
    }
  }

  /**
   * Invalidate user's following feed
   */
  async invalidateFollowingFeed(userId: string) {
    try {
    await this.redisService.deletePattern(`feed:following:${userId}:*`);
    } catch (error) {
      console.warn('Redis cache invalidation failed:', error);
    }
  }

  /**
   * Invalidate single post cache
   */
  async invalidatePostCache(postId: string) {
    try {
    await this.redisService.del(`post:${postId}`);
    } catch (error) {
      console.warn('Redis cache invalidation failed:', error);
    }
  }

  /**
   * Update post counts in cache (without refetching)
   */
  async updatePostCounts(postId: string, updates: {
    likesCount?: number;
    commentsCount?: number;
    viewsCount?: number;
  }) {
    const cacheKey = `post:${postId}`;
    try {
    const cached = await this.redisService.getJson<any>(cacheKey);

    if (cached) {
      if (updates.likesCount !== undefined) {
        cached.likes_count = updates.likesCount;
      }
      if (updates.commentsCount !== undefined) {
        cached.comments_count = updates.commentsCount;
      }
      if (updates.viewsCount !== undefined) {
        cached.views_count = updates.viewsCount;
      }

      await this.redisService.setJson(cacheKey, cached, 60);
      }
    } catch (error) {
      console.warn('Redis cache update failed:', error);
    }
  }

  /**
   * Record view (for analytics and trending calculation)
   */
  async recordView(postId: string, userId?: string) {
    let isNewUniqueView = true;

    try {
      // Increment view counter in Redis
      const viewKey = `post:${postId}:views`;
      await this.redisService.incr(viewKey);

      // If user is logged in, track unique view (sadd returns 1 if newly added)
      if (userId) {
        const uniqueKey = `post:${postId}:unique_viewers`;
        const added = await this.redisService.sadd(uniqueKey, userId);
        await this.redisService.expire(uniqueKey, 24 * 60 * 60); // 24 hours
        isNewUniqueView = added === 1;
      }
    } catch (error) {
      console.warn('Redis view tracking failed:', error);
    }

    // Persist to Supabase for 30-day analytics (fire-and-forget).
    // Only insert once per unique viewer per 24h window (gated by Redis above).
    if (isNewUniqueView) {
      this.persistViewToSupabase(postId, userId).catch((err) =>
        console.warn('View persist to Supabase failed (non-critical):', err),
      );
    }
  }

  private async persistViewToSupabase(postId: string, userId?: string): Promise<void> {
    // user_id is NOT NULL on post_views — skip anonymous views entirely
    if (!userId) return;
    const client = this.supabaseService.getClient();
    const { error } = await client.from('post_views').insert({
      post_id: postId,
      user_id: userId,
      viewed_at: new Date().toISOString(),
    });
    // Unique constraint fires when the same user re-views within 24h — not an error
    if (error && !error.message?.includes('unique') && !error.code?.includes('23505')) {
      console.warn('View persist to Supabase failed:', error.message);
    }
  }
}
