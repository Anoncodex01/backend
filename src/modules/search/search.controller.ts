import {
  Controller,
  Get,
  Query,
  Headers,
} from '@nestjs/common';
import { SearchService } from './search.service';
import { AuthService } from '../auth/auth.service';

@Controller('search')
export class SearchController {
  constructor(
    private searchService: SearchService,
    private authService: AuthService,
  ) {}

  /**
   * GET /v1/search
   * Search users and posts (cached)
   */
  @Get()
  async search(
    @Query('q') query: string,
    @Query('type') type: 'all' | 'users' | 'posts' = 'all',
    @Query('limit') limit: number = 20,
    @Query('offset') offset: number = 0,
    @Headers('authorization') authHeader?: string,
  ) {
    if (!query || query.length < 2) {
      return {
        success: true,
        data: { users: [], posts: [] },
        message: 'Query too short',
      };
    }

    // Extract user ID if authenticated (for recording searches)
    let userId: string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.replace('Bearer ', '');
        const payload = await this.authService.verifySupabaseToken(token);
        userId = payload.sub;
      } catch {
        // Continue as anonymous
      }
    }

    const results = await this.searchService.search(query, { type, limit, offset });

    // Record search for analytics (non-blocking)
    this.searchService.recordSearch(query, userId).catch(() => {});

    return {
      success: true,
      data: results,
      meta: {
        query,
        type,
        limit,
        offset,
        usersCount: results.users.length,
        postsCount: results.posts.length,
      },
    };
  }

  /**
   * GET /v1/search/users
   * Search users only (cached)
   */
  @Get('users')
  async searchUsers(
    @Query('q') query: string,
    @Query('limit') limit: number = 20,
    @Query('offset') offset: number = 0,
  ) {
    if (!query || query.length < 2) {
      return {
        success: true,
        data: [],
        message: 'Query too short',
      };
    }

    const users = await this.searchService.searchUsers(query, limit, offset);

    return {
      success: true,
      data: users,
      meta: {
        query,
        limit,
        offset,
        count: users.length,
        hasMore: users.length === limit,
      },
    };
  }

  /**
   * GET /v1/search/posts
   * Search posts only (cached)
   */
  @Get('posts')
  async searchPosts(
    @Query('q') query: string,
    @Query('limit') limit: number = 20,
    @Query('offset') offset: number = 0,
  ) {
    if (!query || query.length < 2) {
      return {
        success: true,
        data: [],
        message: 'Query too short',
      };
    }

    const posts = await this.searchService.searchPosts(query, limit, offset);

    return {
      success: true,
      data: posts,
      meta: {
        query,
        limit,
        offset,
        count: posts.length,
        hasMore: posts.length === limit,
      },
    };
  }

  /**
   * GET /v1/search/trending
   * Get trending search topics
   */
  @Get('trending')
  async getTrending() {
    const trending = await this.searchService.getTrendingSearches();

    return {
      success: true,
      data: trending,
    };
  }

  /**
   * GET /v1/search/recent
   * Get user's recent searches (authenticated)
   */
  @Get('recent')
  async getRecentSearches(
    @Query('limit') limit: number = 10,
    @Headers('authorization') authHeader?: string,
  ) {
    if (!authHeader?.startsWith('Bearer ')) {
      return {
        success: true,
        data: [],
        message: 'Authentication required',
      };
    }

    try {
      const token = authHeader.replace('Bearer ', '');
      const payload = await this.authService.verifySupabaseToken(token);
      const searches = await this.searchService.getRecentSearches(payload.sub, limit);

      return {
        success: true,
        data: searches,
      };
    } catch {
      return {
        success: true,
        data: [],
        message: 'Invalid token',
      };
    }
  }
}

