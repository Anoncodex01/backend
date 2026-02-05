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
    this.trendingTtl = this.configService.get('CACHE_TRENDING_TTL', 120);
    this.reelsTtl = this.configService.get('CACHE_REELS_TTL', 60);
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
  }) {
    const limit = options.limit || 20;
    const offset = options.offset || 0;
    const cursor = options.cursor;
    const isFirstPage = !cursor && offset === 0;
    const cacheKey = 'feed:reels:page1';

    let posts: any[] | null = null;
    if (isFirstPage) {
      try {
        posts = await this.redisService.getJson<any[]>(cacheKey);
      } catch (error) {
        console.warn('Redis reels cache read failed, falling back to database:', error);
      }
    }

    if (!posts) {
      posts = await this.supabaseService.getReelsPosts(limit, offset, cursor);
      if (isFirstPage) {
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
   * Enrich posts with user's like/save status
   */
  private async enrichPostsWithUserStatus(posts: any[], userId: string) {
    const postIds = posts.map((p) => p.id);
    
    // Batch fetch interaction status
    const statusPromises = postIds.map((postId) =>
      this.supabaseService.getPostInteractionStatus(postId, userId),
    );

    const statuses = await Promise.all(statusPromises);

    return posts.map((post, index) => ({
      ...post,
      is_liked: statuses[index].isLiked,
      is_saved: statuses[index].isSaved,
    }));
  }

  /**
   * Invalidate feed caches (call when new post is created)
   */
  async invalidateFeedCache() {
    try {
      await this.redisService.deletePattern('feed:foryou:*');
      await this.redisService.del('feed:trending:page1');
      await this.redisService.del('feed:reels:page1');
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
    try {
    // Increment view counter in Redis
    const viewKey = `post:${postId}:views`;
    await this.redisService.incr(viewKey);

    // If user is logged in, track unique view
    if (userId) {
      const uniqueKey = `post:${postId}:unique_viewers`;
      await this.redisService.sadd(uniqueKey, userId);
      await this.redisService.expire(uniqueKey, 24 * 60 * 60); // 24 hours
      }
    } catch (error) {
      console.warn('Redis view tracking failed:', error);
      // Continue without tracking - not critical
    }
  }
}

