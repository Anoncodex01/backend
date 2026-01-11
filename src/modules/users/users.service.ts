import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../core/redis/redis.service';
import { SupabaseService } from '../../core/supabase/supabase.service';

@Injectable()
export class UsersService {
  private profileTtl: number;
  private statsTtl: number;

  constructor(
    private redisService: RedisService,
    private supabaseService: SupabaseService,
    private configService: ConfigService,
  ) {
    // Profile cache for 5 minutes, stats for 2 minutes
    this.profileTtl = this.configService.get('CACHE_PROFILE_TTL', 300);
    this.statsTtl = this.configService.get('CACHE_STATS_TTL', 120);
  }

  /**
   * Get user profile with caching
   * Cache hit = instant response, cache miss = fetch from Supabase
   * Gracefully falls back to Supabase if Redis is unavailable
   */
  async getProfile(userId: string, currentUserId?: string) {
    const cacheKey = `user:profile:${userId}`;

    // Try cache first (with error handling)
    let profile: any = null;
    try {
      profile = await this.redisService.getJson<any>(cacheKey);
    } catch (error) {
      console.warn('Redis cache read failed, falling back to database:', error);
    }

    if (!profile) {
      // Fetch from database
      profile = await this.supabaseService.getUser(userId);
      
      // Cache the result (with error handling)
      if (profile) {
        try {
        await this.redisService.setJson(cacheKey, profile, this.profileTtl);
        } catch (error) {
          console.warn('Redis cache write failed, continuing without cache:', error);
        }
      }
    }

    // Enrich with stats and follow status if needed
    if (profile) {
      const [stats, isFollowing] = await Promise.all([
        this.getStats(userId),
        currentUserId && currentUserId !== userId
          ? this.isFollowing(currentUserId, userId)
          : Promise.resolve(false),
      ]);

      return {
        ...profile,
        ...stats,
        is_following: isFollowing,
      };
    }

    return profile;
  }

  /**
   * Get user by username with caching
   */
  async getProfileByUsername(username: string, currentUserId?: string) {
    const cacheKey = `user:username:${username}`;

    // Try to get user ID from username cache (with error handling)
    let userId: string | null = null;
    try {
      userId = await this.redisService.get(cacheKey);
    } catch (error) {
      console.warn('Redis cache read failed, falling back to database:', error);
    }

    if (!userId) {
      const user = await this.supabaseService.getUserByUsername(username);
      if (user && user.id) {
        const newUserId = user.id as string;
        // Cache username -> userId mapping (with error handling)
        try {
        await this.redisService.set(cacheKey, newUserId, this.profileTtl);
        // Also cache the profile
        await this.redisService.setJson(`user:profile:${newUserId}`, user, this.profileTtl);
        } catch (error) {
          console.warn('Redis cache write failed, continuing without cache:', error);
        }
        return this.getProfile(newUserId, currentUserId);
      }
      return null;
    }

    return this.getProfile(userId, currentUserId);
  }

  /**
   * Get user stats with caching (posts, followers, following counts)
   */
  async getStats(userId: string) {
    const cacheKey = `user:stats:${userId}`;

    let stats: any = null;
    try {
      stats = await this.redisService.getJson<any>(cacheKey);
    } catch (error) {
      console.warn('Redis cache read failed, falling back to database:', error);
    }

    if (!stats) {
      stats = await this.supabaseService.getUserStats(userId);
      try {
      await this.redisService.setJson(cacheKey, stats, this.statsTtl);
      } catch (error) {
        console.warn('Redis cache write failed, continuing without cache:', error);
      }
    }

    return stats;
  }

  /**
   * Get user's posts with caching
   */
  async getUserPosts(userId: string, options: {
    limit?: number;
    offset?: number;
    isPublic?: boolean;
  } = {}) {
    const limit = options.limit || 20;
    const offset = options.offset || 0;
    const isPublic = options.isPublic ?? true;
    
    const cacheKey = `user:posts:${userId}:${isPublic}:${offset}:${limit}`;

    let posts: any[] | null = null;
    try {
      posts = await this.redisService.getJson<any[]>(cacheKey);
    } catch (error) {
      console.warn('Redis cache read failed, falling back to database:', error);
    }

    if (!posts) {
      posts = await this.supabaseService.getUserPosts(userId, {
        limit,
        offset,
        isPublic,
      });
      
      // Cache for 2 minutes (posts update more frequently)
      try {
      await this.redisService.setJson(cacheKey, posts, 120);
      } catch (error) {
        console.warn('Redis cache write failed, continuing without cache:', error);
      }
    }

    return posts || [];
  }

  /**
   * Check if user is following another user
   */
  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const cacheKey = `follow:${followerId}:${followingId}`;
    
    let cached: string | null = null;
    try {
      cached = await this.redisService.get(cacheKey);
    } catch (error) {
      console.warn('Redis cache read failed, falling back to database:', error);
    }
    
    if (cached !== null) {
      return cached === 'true';
    }

    const isFollowing = await this.supabaseService.isFollowing(followerId, followingId);
    try {
    await this.redisService.set(cacheKey, isFollowing ? 'true' : 'false', 300);
    } catch (error) {
      console.warn('Redis cache write failed, continuing without cache:', error);
    }
    
    return isFollowing;
  }

  /**
   * Get user's followers
   */
  async getFollowers(userId: string, limit = 20, offset = 0) {
    const cacheKey = `user:followers:${userId}:${offset}:${limit}`;

    let followers: any[] | null = null;
    try {
      followers = await this.redisService.getJson<any[]>(cacheKey);
    } catch (error) {
      console.warn('Redis cache read failed, falling back to database:', error);
    }

    if (!followers) {
      followers = await this.supabaseService.getFollowers(userId, limit, offset);
      try {
      await this.redisService.setJson(cacheKey, followers, 120);
      } catch (error) {
        console.warn('Redis cache write failed, continuing without cache:', error);
      }
    }

    return followers || [];
  }

  /**
   * Get users the user is following
   */
  async getFollowing(userId: string, limit = 20, offset = 0) {
    const cacheKey = `user:following:${userId}:${offset}:${limit}`;

    let following: any[] | null = null;
    try {
      following = await this.redisService.getJson<any[]>(cacheKey);
    } catch (error) {
      console.warn('Redis cache read failed, falling back to database:', error);
    }

    if (!following) {
      following = await this.supabaseService.getFollowing(userId, limit, offset);
      try {
      await this.redisService.setJson(cacheKey, following, 120);
      } catch (error) {
        console.warn('Redis cache write failed, continuing without cache:', error);
      }
    }

    return following || [];
  }

  /**
   * Invalidate user profile cache (after update)
   */
  async invalidateProfile(userId: string) {
    try {
    await this.redisService.del(`user:profile:${userId}`);
    await this.redisService.del(`user:stats:${userId}`);
    await this.redisService.deletePattern(`user:posts:${userId}:*`);
    } catch (error) {
      console.warn('Redis cache invalidation failed:', error);
    }
  }

  /**
   * Invalidate follow cache (after follow/unfollow)
   */
  async invalidateFollowCache(followerId: string, followingId: string) {
    try {
    await this.redisService.del(`follow:${followerId}:${followingId}`);
    await this.redisService.del(`user:stats:${followerId}`);
    await this.redisService.del(`user:stats:${followingId}`);
    await this.redisService.deletePattern(`user:followers:${followingId}:*`);
    await this.redisService.deletePattern(`user:following:${followerId}:*`);
    } catch (error) {
      console.warn('Redis cache invalidation failed:', error);
    }
  }
}

