import {
  Controller,
  Get,
  Param,
  Query,
  Post,
  UseGuards,
  Headers,
  ParseBoolPipe,
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
    @Query('limit') limit: number = 20,
    @Query('offset') offset: number = 0,
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
    @Query('limit') limit: number = 20,
    @Query('offset') offset: number = 0,
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
    @Query('fresh') fresh?: string,
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

    const forceFresh = fresh === '1' || fresh?.toLowerCase() == 'true';
    const posts = await this.feedService.getReelsFeed({ userId, limit, offset, cursor, fresh: forceFresh });
    const nextCursor = posts.length >= limit && posts.length > 0
      ? (posts[posts.length - 1] as any).created_at
      : undefined;

    return {
      success: true,
      data: posts,
      meta: {
        limit,
        offset,
        count: posts.length,
        hasMore: posts.length === limit,
        nextCursor,
      },
    };
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
