import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { CommentsService } from '../comments/comments.service';
import { FeedService } from './feed.service';
import {
  collectReelsPrefetchUrls,
  expandHlsWarmUrls,
} from './feed-cdn.util';

export interface ReelsWarmPayload {
  posts: any[];
  prefetchUrls: string[];
  warmedAt: string;
  fromCache: boolean;
}

@Injectable()
export class FeedWarmService {
  private readonly logger = new Logger(FeedWarmService.name);
  private readonly warmCommentsCount: number;
  private readonly warmPostsCount: number;
  private readonly cdnPrefetchCount: number;
  private trendingWarmInFlight = false;
  private readonly userWarmLastAt = new Map<string, number>();
  private readonly userWarmMinIntervalMs: number;

  constructor(
    private readonly feedService: FeedService,
    private readonly commentsService: CommentsService,
    private readonly configService: ConfigService,
  ) {
    this.warmCommentsCount = this.configService.get<number>(
      'FEED_WARM_COMMENTS_COUNT',
      5,
    );
    this.warmPostsCount = this.configService.get<number>(
      'FEED_WARM_POSTS_COUNT',
      20,
    );
    this.cdnPrefetchCount = this.configService.get<number>(
      'FEED_WARM_CDN_URL_COUNT',
      12,
    );
    this.userWarmMinIntervalMs = this.configService.get<number>(
      'FEED_WARM_USER_MIN_INTERVAL_MS',
      30_000,
    );
  }

  /**
   * Build personalized reels in Redis + warm comments + prefetch CDN at DAR edge.
   */
  async warmUserReelsFeed(
    userId: string,
    limit = this.warmPostsCount,
  ): Promise<ReelsWarmPayload> {
    const now = Date.now();
    const last = this.userWarmLastAt.get(userId) ?? 0;
    const throttled = now - last < this.userWarmMinIntervalMs;

    const posts = await this.feedService.getReelsFeed({
      userId,
      limit,
      offset: 0,
      fresh: false,
    });

    if (!throttled) {
      this.userWarmLastAt.set(userId, now);
    }

    const commentTargets = posts.slice(0, this.warmCommentsCount);
    await Promise.all(
      commentTargets.map((post) =>
        this.commentsService
          .getComments(post.id, { userId, limit: 20, offset: 0 })
          .catch((err) => {
            this.logger.warn(
              `Comment warm failed for post ${post.id}: ${err?.message || err}`,
            );
          }),
      ),
    );

    const prefetchUrls = collectReelsPrefetchUrls(
      posts,
      Math.min(8, limit),
    );

    if (!throttled) {
      this.warmCdnUrls(prefetchUrls).catch((err) => {
        this.logger.warn(`CDN warm after user feed failed: ${err?.message || err}`);
      });
    }

    return {
      posts,
      prefetchUrls,
      warmedAt: new Date().toISOString(),
      fromCache: throttled,
    };
  }

  /**
   * Fire-and-forget warm (app open / background).
   */
  scheduleUserWarm(userId: string): void {
    this.warmUserReelsFeed(userId).catch((err) => {
      this.logger.warn(`Scheduled user warm failed: ${err?.message || err}`);
    });
  }

  /**
   * Pre-warm trending + global reels at Cloudflare edge before TZ peak hours.
   * Runs at 11:00 and 16:00 UTC (~2 PM and 7 PM EAT).
   */
  @Cron('0 0 11,16 * * *')
  async warmTrendingReelsAtEdge(): Promise<void> {
    if (this.trendingWarmInFlight) return;
    this.trendingWarmInFlight = true;

    try {
      this.logger.log('Starting scheduled CDN edge warm (trending + reels page1)');

      const [trending, reels] = await Promise.all([
        this.feedService.getTrendingFeed({ limit: 25 }),
        this.feedService.getReelsFeed({ limit: 25, offset: 0, fresh: false }),
      ]);

      const merged = [...trending, ...reels];
      const seen = new Set<string>();
      const uniquePosts = merged.filter((post) => {
        const id = post?.id?.toString();
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      const urls = collectReelsPrefetchUrls(uniquePosts, 20);
      const warmed = await this.warmCdnUrls(urls);
      this.logger.log(
        `CDN edge warm complete: ${warmed}/${urls.length} URLs (${uniquePosts.length} posts)`,
      );
    } catch (err) {
      this.logger.warn(`Scheduled CDN warm failed: ${(err as Error)?.message || err}`);
    } finally {
      this.trendingWarmInFlight = false;
    }
  }

  /** HTTP prefetch so Cloudflare DAR caches HLS segments + posters. */
  async warmCdnUrls(urls: string[]): Promise<number> {
    const targets = urls.slice(0, this.cdnPrefetchCount);
    let warmed = 0;

    for (const url of targets) {
      try {
        if (url.toLowerCase().includes('.m3u8')) {
          const expanded = await expandHlsWarmUrls(url, (u) =>
            this.fetchText(u),
          );
          for (const expandedUrl of expanded) {
            const ok = await this.prefetchUrl(expandedUrl);
            if (ok) warmed++;
          }
          continue;
        }

        const ok = await this.prefetchUrl(url);
        if (ok) warmed++;
      } catch (err) {
        this.logger.debug(`CDN prefetch skip ${url}: ${(err as Error)?.message || err}`);
      }
    }

    return warmed;
  }

  private async prefetchUrl(url: string): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'WhapVibez-EdgeWarm/1.0',
          Range: 'bytes=0-65535',
        },
      });
      return res.ok || res.status === 206;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchText(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'WhapVibez-EdgeWarm/1.0' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    } finally {
      clearTimeout(timer);
    }
  }
}
