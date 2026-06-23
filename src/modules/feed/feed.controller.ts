import {
  Controller,
  Get,
  Param,
  Query,
  Post,
  UseGuards,
  Headers,
  ParseBoolPipe,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { FeedService } from './feed.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';

@Controller('feed')
export class FeedController {
  constructor(
    private feedService: FeedService,
    private authService: AuthService,
  ) {}

  /**
   * GET /v1/feed
   * 
   * Main feed endpoint that replaces multiple Supabase calls
   * Flutter calls this ONCE instead of 10 separate requests
   */
  @Get()
  async getFeed(
    @Query('tab') tab: 'foryou' | 'following' | 'trending' = 'foryou',
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('cursor') queryCursor?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    // Extract user ID if authenticated
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

    let posts: any[];

    let nextCursor: string | undefined;
    switch (tab) {
      case 'following':
        if (!userId) {
          return {
            success: true,
            data: [],
            message: 'Login required for following feed',
          };
        }
        posts = await this.feedService.getFollowingFeed({ userId, limit, offset });
        break;

      case 'trending': {
        const cursor = typeof queryCursor === 'string' ? queryCursor : undefined;
        posts = await this.feedService.getTrendingFeed({ userId, limit, offset, cursor });
        nextCursor = posts.length >= limit && posts.length > 0 ? (posts[posts.length - 1] as any).created_at : undefined;
        break;
      }

      case 'foryou':
      default:
        posts = await this.feedService.getForYouFeed({ userId, limit, offset });
        break;
    }

    return {
      success: true,
      data: posts,
      meta: {
        tab,
        limit,
        offset,
        count: posts.length,
        hasMore: posts.length === limit,
        ...(nextCursor && { nextCursor }),
      },
    };
  }

  /**
   * GET /v1/feed/profile/:userId
   * Profile posts (optionally video-only), Redis cached
   */
  @Get('profile/:userId')
  async getProfileFeed(
    @Param('userId') profileUserId: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('videoOnly', new ParseBoolPipe({ optional: true })) videoOnly?: boolean,
    @Headers('authorization') authHeader?: string,
  ) {
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

    const posts = await this.feedService.getProfileFeed({
      profileUserId,
      userId,
      limit,
      offset,
      videoOnly: videoOnly ?? false,
    });

    return {
      success: true,
      data: posts,
      meta: {
        profileUserId,
        limit,
        offset,
        videoOnly,
        count: posts.length,
        hasMore: posts.length === limit,
      },
    };
  }

  /**
   * GET /v1/feed/reels
   * Reels feed (video-only, cursor pagination, first page cached)
   */
  @Get('reels')
  async getReels(
    @Query('limit') limit: number = 20,
    @Query('offset') offset: number = 0,
    @Query('cursor') cursor?: string,
    @Query('createdAfter') createdAfter?: string,
    @Query('fresh') fresh?: string,
    @Query('mode') mode?: string,
    @Headers('authorization') authHeader?: string,
  ) {
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

    const forceFresh = fresh === '1' || fresh?.toLowerCase() === 'true';
    const safeLimit = Number.isFinite(Number(limit))
      ? Math.min(Math.max(Number(limit), 1), 50)
      : 20;
    const safeOffset = Number.isFinite(Number(offset))
      ? Math.max(Number(offset), 0)
      : 0;
    const safeCreatedAfter = createdAfter && !Number.isNaN(Date.parse(createdAfter))
      ? new Date(createdAfter).toISOString()
      : undefined;
    const safeMode = mode === 'old_gems' ? 'old_gems' : 'reels';
    const posts = await this.feedService.getReelsFeed({
      userId,
      limit: safeLimit,
      offset: safeOffset,
      cursor,
      fresh: forceFresh,
      createdAfter: safeCreatedAfter,
      mode: safeMode,
    });
    const cursorPost = safeMode === 'old_gems'
      ? [...posts].reverse().find((post: any) => post?._feed_source !== 'trending_gem')
      : posts[posts.length - 1];
    const nextCursor = posts.length >= safeLimit && cursorPost
      ? ((cursorPost as any)._feed_cursor || (cursorPost as any).created_at)
      : undefined;

    return {
      success: true,
      data: posts,
      meta: {
        limit: safeLimit,
        offset: safeOffset,
        count: posts.length,
        hasMore: posts.length === safeLimit,
        nextCursor,
        mode: safeMode,
      },
    };
  }

  /**
   * GET /v1/feed/stories
   * Active stories (< 24 h), globally Redis-cached for 45 s.
   * Auth is optional — returns the same story list for all users.
   */
  @Get('stories')
  async getStories() {
    const stories = await this.feedService.getActiveStories();
    return {
      success: true,
      data: stories,
      meta: { count: stories.length },
    };
  }

  /**
   * POST /v1/feed/stories/invalidate
   * Bust the Redis stories cache after a story is created or deleted.
   * No auth required — the actual data mutation is guarded by Supabase RLS.
   */
  @Post('stories/invalidate')
  async invalidateStoriesCache() {
    await this.feedService.invalidateStoriesCache();
    return { success: true };
  }

  /**
   * GET /v1/feed/posts/:id
   * Get single post with interaction status
   */
  @Get('posts/:id')
  async getPost(
    @Param('id') postId: string,
    @Headers('authorization') authHeader?: string,
  ) {
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

    const post = await this.feedService.getPost(postId, userId);

    return {
      success: true,
      data: post,
    };
  }

  /**
   * POST /v1/feed/posts/:id/view
   * Record a view (authenticated)
   */
  @Post('posts/:id/view')
  async recordView(
    @Param('id') postId: string,
    @Headers('authorization') authHeader?: string,
  ) {
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

    await this.feedService.recordView(postId, userId);

    return {
      success: true,
    };
  }

  /**
   * POST /v1/feed/refresh
   * Force refresh feed cache (admin/internal use)
   */
  @Post('refresh')
  @UseGuards(AuthGuard)
  async refreshFeed() {
    await this.feedService.invalidateFeedCache();

    return {
      success: true,
      message: 'Feed cache invalidated',
    };
  }
}
