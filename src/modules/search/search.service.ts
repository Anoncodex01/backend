import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../core/redis/redis.service';
import { SupabaseService } from '../../core/supabase/supabase.service';

@Injectable()
export class SearchService {
  private searchTtl: number;

  constructor(
    private redisService: RedisService,
    private supabaseService: SupabaseService,
    private configService: ConfigService,
  ) {
    // Search results cache for 2 minutes
    this.searchTtl = this.configService.get('CACHE_SEARCH_TTL', 120);
  }

  /**
   * Search users with caching
   */
  async searchUsers(query: string, limit = 20, offset = 0) {
    if (!query || query.length < 2) return [];

    const normalizedQuery = query.toLowerCase().trim();
    const cacheKey = `search:users:${normalizedQuery}:${offset}:${limit}`;

    let results = await this.redisService.getJson<any[]>(cacheKey);

    if (!results) {
      results = await this.supabaseService.searchUsers(normalizedQuery, limit, offset);
      await this.redisService.setJson(cacheKey, results, this.searchTtl);
    }

    return results;
  }

  /**
   * Search posts with caching
   */
  async searchPosts(query: string, limit = 20, offset = 0, videoOnly = false) {
    if (!query || query.length < 2) return [];

    const normalizedQuery = query.toLowerCase().trim();
    const cacheKey = `search:posts:${normalizedQuery}:${offset}:${limit}:${videoOnly}`;

    let results = await this.redisService.getJson<any[]>(cacheKey);

    if (!results) {
      results = await this.supabaseService.searchPosts(normalizedQuery, limit, offset, videoOnly);
      await this.redisService.setJson(cacheKey, results, this.searchTtl);
    }

    return results;
  }

  /**
   * Search video posts only (for reels/search screen when clicking video tab)
   */
  async searchVideos(query: string, limit = 20, offset = 0) {
    return this.searchPosts(query, limit, offset, true);
  }

  /**
   * Combined search (users + posts)
   */
  async search(query: string, options: {
    type?: 'all' | 'users' | 'posts';
    limit?: number;
    offset?: number;
  } = {}) {
    const type = options.type || 'all';
    const limit = options.limit || 20;
    const offset = options.offset || 0;

    if (type === 'users') {
      return {
        users: await this.searchUsers(query, limit, offset),
        posts: [],
      };
    }

    if (type === 'posts') {
      return {
        users: [],
        posts: await this.searchPosts(query, limit, offset),
      };
    }

    // Search both
    const [users, posts] = await Promise.all([
      this.searchUsers(query, limit / 2, 0),
      this.searchPosts(query, limit / 2, 0),
    ]);

    return { users, posts };
  }

  /**
   * Get trending searches (cached list)
   */
  async getTrendingSearches() {
    const cacheKey = 'search:trending';
    
    let trending = await this.redisService.getJson<string[]>(cacheKey);
    
    if (!trending) {
      // Return default trending topics
      trending = [
        'music',
        'dance',
        'comedy',
        'fitness',
        'cooking',
        'travel',
        'fashion',
        'tech',
      ];
      await this.redisService.setJson(cacheKey, trending, 3600); // 1 hour
    }

    return trending;
  }

  /**
   * Record a search query for analytics
   */
  async recordSearch(query: string, userId?: string) {
    if (!query || query.length < 2) return;

    // Increment search count
    const countKey = `search:count:${query.toLowerCase().trim()}`;
    await this.redisService.incr(countKey);
    
    // Track user's recent searches if authenticated
    if (userId) {
      const userSearchKey = `user:${userId}:searches`;
      await this.redisService.lpush(userSearchKey, query);
      // Keep only last 20 searches
      await this.redisService.expire(userSearchKey, 604800); // 7 days
    }
  }

  /**
   * Get user's recent searches
   */
  async getRecentSearches(userId: string, limit = 10) {
    const userSearchKey = `user:${userId}:searches`;
    const searches = await this.redisService.lrange(userSearchKey, 0, limit - 1);
    // Remove duplicates while preserving order
    return [...new Set(searches)];
  }
}

