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
    const appStoreUrl = 'https://apps.apple.com/app/whapvibez/id000000000';
    const ua = (req.headers['user-agent'] || '').toString();
    const isAndroid = /Android/i.test(ua);
    const redirectUrl = isAndroid
      ? `intent://post/${id}#Intent;scheme=whapvibez;package=com.whapvibez.app;S.browser_fallback_url=${encodeURIComponent(playStoreUrl)};end`
      : deepLink;
    const fallbackUrl = isAndroid ? playStoreUrl : appStoreUrl;
    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="theme-color" content="#0f0f14" />
          <title>Redirecting to WhapVibez</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-height: 100vh; background: #0f0f14; display: flex; align-items: center; justify-content: center; }
            .popup { background: linear-gradient(145deg, #1a1a24 0%, #12121a 100%); border-radius: 20px; padding: 32px 40px; max-width: 340px; width: 90%; box-shadow: 0 25px 50px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05); text-align: center; animation: popIn 0.4s ease-out; }
            @keyframes popIn { from { opacity: 0; transform: scale(0.9) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
            .spinner { width: 48px; height: 48px; margin: 0 auto 20px; border: 3px solid rgba(124,58,237,0.2); border-top-color: #7c3aed; border-radius: 50%; animation: spin 0.8s linear infinite; }
            @keyframes spin { to { transform: rotate(360deg); } }
            .title { color: #fff; font-size: 18px; font-weight: 600; margin-bottom: 8px; letter-spacing: -0.02em; }
            .sub { color: rgba(255,255,255,0.5); font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="popup">
            <div class="spinner"></div>
            <p class="title">Redirecting to WhapVibez</p>
            <p class="sub">Please wait, opening the app…</p>
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
}

