import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
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

  @Get('share/post/:id')
  sharePost(@Param('id') id: string, @Res() res: Response) {
    const deepLink = `whapvibez://post/${id}`;
    const fallback = `https://whapvibez.com/post/${id}`;
    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Open WhapVibez</title>
        </head>
        <body style="font-family: Arial, sans-serif; padding: 24px;">
          <h2>Opening WhapVibez…</h2>
          <p>If nothing happens, tap the button below.</p>
          <a href="${deepLink}" style="display:inline-block; padding:12px 18px; background:#111827; color:#fff; text-decoration:none; border-radius:10px;">Open in app</a>
          <p style="margin-top:16px; font-size:12px; color:#666;">Fallback: ${fallback}</p>
          <script>
            window.location.href = "${deepLink}";
            setTimeout(function () { window.location.href = "${fallback}"; }, 1500);
          </script>
        </body>
      </html>
    `;
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);
  }
}

