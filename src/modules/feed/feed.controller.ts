import {
  Controller,
  Get,
  Param,
  Query,
  Post,
  Body,
  UseGuards,
  Headers,
  ParseBoolPipe,
  ParseIntPipe,
  DefaultValuePipe,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FeedService } from './feed.service';
import { FeedWarmService } from './feed-warm.service';
import { ReelsAiService } from './reels-ai.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';

@Controller('feed')
export class FeedController {
  constructor(
    private feedService: FeedService,
    private feedWarmService: FeedWarmService,
    private reelsAiService: ReelsAiService,
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
   * GET /v1/feed/reels/warm
   * Pre-build personalized reels + comment cache + CDN edge prefetch (DAR).
   */
  @Get('reels/warm')
  @UseGuards(AuthGuard)
  async warmReelsFeed(
    @CurrentUser() user: any,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), 30);
    const payload = await this.feedWarmService.warmUserReelsFeed(
      user.sub,
      safeLimit,
    );

    return {
      success: true,
      data: payload,
      meta: {
        count: payload.posts.length,
        prefetchUrlCount: payload.prefetchUrls.length,
        warmedAt: payload.warmedAt,
      },
    };
  }

  /**
   * POST /v1/feed/reels/warm
   * Fire-and-forget warm on app open (does not block UI).
   */
  @Post('reels/warm')
  @UseGuards(AuthGuard)
  async warmReelsFeedAsync(@CurrentUser() user: any) {
    this.feedWarmService.scheduleUserWarm(user.sub);
    return { success: true, message: 'Reels warm scheduled' };
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
    @Query('storageType') storageType?: string,
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
    const safeStorageType = storageType?.trim().toLowerCase() || undefined;
    const posts = await this.feedService.getReelsFeed({
      userId,
      limit: safeLimit,
      offset: safeOffset,
      cursor,
      fresh: forceFresh,
      createdAfter: safeCreatedAfter,
      mode: safeMode,
      storageType: safeStorageType,
    });
    const cursorPost = safeMode === 'old_gems'
      ? [...posts].reverse().find((post: any) => post?._feed_source !== 'trending_gem')
      : posts[posts.length - 1];
    const nextCursor = posts.length >= safeLimit && cursorPost
      ? ((cursorPost as any)._feed_cursor || (cursorPost as any).created_at)
      : undefined;

    const rankSource = (posts[0] as any)?._feed_rank_source as string | undefined;

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
        rankSource: rankSource ?? (userId ? 'rules' : 'global'),
        personalized: !!userId && safeMode === 'reels',
      },
    };
  }

  /**
   * GET /v1/feed/explore
   * Explore grid (videos + images), AI-personalized when logged in.
   */
  @Get('explore')
  async getExploreFeed(
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
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

    const forceFresh = fresh === '1' || fresh?.toLowerCase() === 'true';
    const safeLimit = Number.isFinite(Number(limit))
      ? Math.min(Math.max(Number(limit), 1), 60)
      : 30;
    const safeOffset = Number.isFinite(Number(offset))
      ? Math.max(Number(offset), 0)
      : 0;

    const posts = await this.feedService.getExploreFeed({
      userId,
      limit: safeLimit,
      offset: safeOffset,
      fresh: forceFresh,
    });

    const rankSource = (posts[0] as any)?._feed_rank_source as string | undefined;

    return {
      success: true,
      data: posts,
      meta: {
        limit: safeLimit,
        offset: safeOffset,
        count: posts.length,
        hasMore: posts.length === safeLimit,
        rankSource: rankSource ?? (userId ? 'rules' : 'global'),
        personalized: !!userId,
      },
    };
  }

  /**
   * POST /v1/feed/reels/watch-event
   * Track watch time for AI For You ranking.
   */
  @Post('reels/watch-event')
  @UseGuards(AuthGuard)
  async recordReelWatchEvent(
    @CurrentUser() user: any,
    @Body()
    body: {
      postId: string;
      watchedMs: number;
      durationMs: number;
      completed?: boolean;
    },
  ) {
    if (!body?.postId) {
      return { success: false, message: 'postId required' };
    }

    const watchedMs = Math.max(0, Number(body.watchedMs) || 0);
    const durationMs = Math.max(0, Number(body.durationMs) || 0);
    const completed =
      body.completed === true ||
      (durationMs > 0 && watchedMs / durationMs >= 0.85);

    await this.reelsAiService.recordWatchEvent({
      userId: user.sub,
      postId: body.postId,
      watchedMs,
      durationMs,
      completed,
    });

    return { success: true };
  }

  /**
   * POST /v1/feed/reels/caption/suggest
   * AI caption + hashtags for upload flow.
   */
  @Post('reels/caption/suggest')
  @UseGuards(AuthGuard)
  async suggestReelCaption(
    @Body()
    body: {
      caption?: string;
      locationName?: string;
      hashtags?: string[];
    },
  ) {
    if (!this.reelsAiService.isGeminiConfigured()) {
      return {
        success: false,
        message: 'AI caption is temporarily unavailable. Try again later.',
      };
    }

    const result = await this.reelsAiService.suggestCaption({
      caption: body?.caption,
      locationName: body?.locationName,
      hashtags: body?.hashtags,
      forUpload: true,
    });

    if (!result) {
      return { success: false, message: 'Could not generate caption' };
    }

    return { success: true, data: result };
  }

  /**
   * POST /v1/feed/reels/:postId/generate-caption
   * AI caption for an existing reel (owner).
   */
  @Post('reels/:postId/generate-caption')
  @UseGuards(AuthGuard)
  async generateReelCaption(
    @Param('postId') postId: string,
    @CurrentUser() user: any,
  ) {
    const result = await this.reelsAiService.generateCaptionForPost(
      postId,
      user.sub,
    );
    if (!result) {
      throw new ForbiddenException('Cannot generate caption for this reel');
    }
    return { success: true, data: result };
  }

  /**
   * POST /v1/feed/reels/:postId/apply-caption
   * Save AI caption to reel (owner).
   */
  @Post('reels/:postId/apply-caption')
  @UseGuards(AuthGuard)
  async applyReelCaption(
    @Param('postId') postId: string,
    @CurrentUser() user: any,
    @Body() body: { caption: string; hashtags?: string[] },
  ) {
    const caption = body?.caption?.trim();
    if (!caption) {
      return { success: false, message: 'caption required' };
    }

    const ok = await this.reelsAiService.applyCaptionToPost(
      postId,
      user.sub,
      caption,
      body.hashtags ?? [],
    );
    if (!ok) {
      throw new NotFoundException('Reel not found or not owned by you');
    }
    return { success: true };
  }

  /**
   * GET /v1/feed/stories
   * Active stories (< 24 h), globally Redis-cached for 45 s.
   * When authenticated, includes viewedStoryIds in meta for the current user.
   */
  @Get('stories')
  async getStories(@Headers('authorization') authHeader?: string) {
    let userId: string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.replace('Bearer ', '');
        const payload = await this.authService.verifySupabaseToken(token);
        userId = payload.sub;
      } catch {
        // Continue without viewer context
      }
    }

    const stories = await this.feedService.getActiveStories();
    let viewedStoryIds: string[] = [];
    if (userId && stories.length > 0) {
      const storyIds = stories
        .map((story: any) => story?.id?.toString())
        .filter((id: string | undefined): id is string => !!id);
      viewedStoryIds = await this.feedService.getViewedStoryIds(userId, storyIds);
    }

    return {
      success: true,
      data: stories,
      meta: {
        count: stories.length,
        ...(userId ? { viewedStoryIds } : {}),
      },
    };
  }

  /**
   * GET /v1/feed/following
   * Shortcut for the following tab (same as GET /feed?tab=following).
   */
  @Get('following')
  async getFollowingFeedShortcut(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Headers('authorization') authHeader?: string,
  ) {
    let userId: string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.replace('Bearer ', '');
        const payload = await this.authService.verifySupabaseToken(token);
        userId = payload.sub;
      } catch {
        // fall through
      }
    }

    if (!userId) {
      return {
        success: true,
        data: [],
        message: 'Login required for following feed',
      };
    }

    const posts = await this.feedService.getFollowingFeed({ userId, limit, offset });

    return {
      success: true,
      data: posts,
      meta: {
        tab: 'following',
        limit,
        offset,
        count: posts.length,
        hasMore: posts.length === limit,
      },
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
