import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RedisService } from './core/redis/redis.service';
import { SupabaseService } from './core/supabase/supabase.service';

@Controller()
export class HealthController {
  constructor(
    private redisService: RedisService,
    private supabaseService: SupabaseService,
  ) {}

  @Get('health')
  async healthCheck() {
    const checks: Record<string, boolean> = {};

    // Check Redis
    try {
      await this.redisService.set('health_check', 'ok', 10);
      checks.redis = true;
    } catch {
      checks.redis = false;
    }

    const healthy = Object.values(checks).every((v) => v);

    return {
      status: healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
    };
  }

  @Get()
  root() {
    return {
      name: 'WhapVibez API',
      version: '1.0.0',
      docs: '/v1',
    };
  }

  /** Short link: /v1/p/:id — e.g. https://api.whapvibez.com/v1/p/02a229ff-dc5f-4e0e-bf8b-005e0b6d93e9 */
  @Get('p/:id')
  sharePostShort(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    return this.sharePost(id, req, res);
  }

  /** Short link: /v1/u/:username — e.g. https://api.whapvibez.com/v1/u/alvin */
  @Get('u/:username')
  shareUserShort(
    @Param('username') username: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.shareUser(username, req, res);
  }

  /** Short link: /v1/c/:code — e.g. https://api.whapvibez.com/v1/c/ABC123 */
  @Get('c/:code')
  shareCommunityShort(
    @Param('code') code: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.shareCommunity(code, req, res);
  }

  @Get('share/post/:id')
  sharePost(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    return this.renderSharePage({
      req,
      res,
      title: 'Open this post in WhapVibez',
      description: 'Tap to open this shared post in the app.',
      imageUrl: null,
      deepLinkPath: `post/${id}`,
    });
  }

  @Get('share/user/:username')
  async shareUser(
    @Param('username') username: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { data: user } = await this.supabaseService
      .getClient()
      .from('users')
      .select('full_name, username, bio, profile_image_url')
      .eq('username', username)
      .maybeSingle();

    const displayName =
      user?.full_name || user?.username || username;

    return this.renderSharePage({
      req,
      res,
      title: `${displayName} on WhapVibez`,
      description:
        user?.bio ||
        `Open ${displayName}'s profile directly in WhapVibez.`,
      imageUrl: user?.profile_image_url ?? null,
      deepLinkPath: `u/${username}`,
    });
  }

  @Get('share/community/:code')
  async shareCommunity(
    @Param('code') code: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { data: community } = await this.supabaseService
      .getClient()
      .from('communities')
      .select('name, description, image_url, cover_image_url, invite_code')
      .ilike('invite_code', code)
      .maybeSingle();

    const communityName = community?.name || 'Community Invite';

    return this.renderSharePage({
      req,
      res,
      title: `Join ${communityName} on WhapVibez`,
      description:
        community?.description ||
        `Use this invite to open and join ${communityName} in WhapVibez.`,
      imageUrl: community?.cover_image_url || community?.image_url || null,
      deepLinkPath: `c/${community?.invite_code || code}`,
    });
  }

  private renderSharePage({
    req,
    res,
    title,
    description,
    imageUrl,
    deepLinkPath,
  }: {
    req: Request;
    res: Response;
    title: string;
    description: string;
    imageUrl: string | null;
    deepLinkPath: string;
  }) {
    const playStoreUrl = 'https://play.google.com/store/apps/details?id=com.whapvibez.app';
    const appStoreUrl = 'https://apps.apple.com/app/whapvibez/id000000000';
    const ua = (req.headers['user-agent'] || '').toString();
    const isAndroid = /Android/i.test(ua);
    const deepLink = `whapvibez://${deepLinkPath}`;
    const redirectUrl = isAndroid
      ? `intent://${deepLinkPath}#Intent;scheme=whapvibez;package=com.whapvibez.app;S.browser_fallback_url=${encodeURIComponent(playStoreUrl)};end`
      : deepLink;
    const fallbackUrl = isAndroid ? playStoreUrl : appStoreUrl;
    const escapedTitle = this.escapeHtml(title);
    const escapedDescription = this.escapeHtml(description);
    const escapedImage = imageUrl ? this.escapeHtml(imageUrl) : '';
    const imageMeta = imageUrl
      ? `
          <meta property="og:image" content="${escapedImage}" />
          <meta name="twitter:image" content="${escapedImage}" />
        `
      : '';
    const publicUrl = `${req.protocol}://${req.get('host')}${req.originalUrl || req.url}`;
    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="theme-color" content="#0f0f14" />
          <title>${escapedTitle}</title>
          <meta property="og:title" content="${escapedTitle}" />
          <meta property="og:description" content="${escapedDescription}" />
          <meta property="og:type" content="website" />
          <meta property="og:url" content="${this.escapeHtml(publicUrl)}" />
          <meta property="og:site_name" content="WhapVibez" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content="${escapedTitle}" />
          <meta name="twitter:description" content="${escapedDescription}" />
          ${imageMeta}
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-height: 100vh; background: #0f0f14; display: flex; align-items: center; justify-content: center; }
            .popup { background: linear-gradient(145deg, #1a1a24 0%, #12121a 100%); border-radius: 20px; padding: 32px 40px; max-width: 360px; width: 90%; box-shadow: 0 25px 50px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05); text-align: center; animation: popIn 0.4s ease-out; }
            @keyframes popIn { from { opacity: 0; transform: scale(0.9) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
            .spinner { width: 48px; height: 48px; margin: 0 auto 20px; border: 3px solid rgba(124,58,237,0.2); border-top-color: #7c3aed; border-radius: 50%; animation: spin 0.8s linear infinite; }
            @keyframes spin { to { transform: rotate(360deg); } }
            .title { color: #fff; font-size: 18px; font-weight: 600; margin-bottom: 8px; letter-spacing: -0.02em; }
            .sub { color: rgba(255,255,255,0.6); font-size: 14px; line-height: 1.5; }
          </style>
        </head>
        <body>
          <div class="popup">
            <div class="spinner"></div>
            <p class="title">${escapedTitle}</p>
            <p class="sub">${escapedDescription}</p>
          </div>
          <script>
            (function() {
              var url = '${redirectUrl}';
              var fallback = '${fallbackUrl}';
              window.location.href = url;
              setTimeout(function() { window.location.href = fallback; }, 2200);
            })();
          </script>
        </body>
      </html>
    `;
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
