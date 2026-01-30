import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RedisService } from './core/redis/redis.service';

@Controller()
export class HealthController {
  constructor(private redisService: RedisService) {}

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

  @Get('share/post/:id')
  sharePost(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const deepLink = `whapvibez://post/${id}`;
    const playStoreUrl = 'https://play.google.com/store/apps/details?id=com.whapvibez.app';
    const appStoreUrl = 'https://apps.apple.com/app/whapvibez/id000000000'; // Replace with real App Store ID when published
    const fallback = `https://whapvibez.com/post/${id}`;
    const ua = (req.headers['user-agent'] || '').toString();
    const isAndroid = /Android/i.test(ua);
    const btnHref = isAndroid
      ? `intent://post/${id}#Intent;scheme=whapvibez;package=com.whapvibez.app;S.browser_fallback_url=${encodeURIComponent(playStoreUrl)};end`
      : deepLink;
    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="apple-itunes-app" content="app-id=000000000" />
          <title>Open in WhapVibez</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; padding: 24px; max-width: 360px; margin: 0 auto; text-align: center; }
            .btn { display: inline-block; padding: 14px 28px; background: #7c3aed; color: #fff; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 16px; margin: 8px 0; }
            .btn:active { opacity: 0.9; }
            .fallback { margin-top: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <h2>Open in WhapVibez</h2>
          <p>Tap the button below to open this post in the app.</p>
          <a id="openBtn" href="${btnHref}" class="btn">Open in app</a>
          <p class="fallback">Don't have the app? <a href="${playStoreUrl}">Get it on Google Play</a> or <a href="${appStoreUrl}">App Store</a></p>
          <script>
            document.getElementById('openBtn').onclick = function() {
              var href = this.href;
              window.location.href = href;
              setTimeout(function() {
                if (/Android/i.test(navigator.userAgent)) window.location.href = '${playStoreUrl}';
                else window.location.href = '${fallback}';
              }, 2500);
              return true;
            };
          </script>
        </body>
      </html>
    `;
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);
  }
}

