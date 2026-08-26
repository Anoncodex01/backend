import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MeService } from './me.service';

@Controller('me')
export class MeController {
  constructor(private readonly meService: MeService) {}

  /**
   * GET /v1/me/session-bootstrap
   * One cached call for app open: account status, following IDs, blocks, notification badge.
   */
  @Get('session-bootstrap')
  @UseGuards(AuthGuard)
  async getSessionBootstrap(@CurrentUser() userId: string) {
    const data = await this.meService.getSessionBootstrap(userId);
    return {
      success: true,
      data,
    };
  }

  /**
   * POST /v1/me/session-bootstrap/invalidate
   * Clears Redis bootstrap cache after follow/unfollow or notification read.
   */
  @Post('session-bootstrap/invalidate')
  @UseGuards(AuthGuard)
  async invalidateSessionBootstrap(@CurrentUser() userId: string) {
    await this.meService.invalidateBootstrap(userId);
    return { success: true };
  }

  /**
   * GET /v1/me/community-unread
   * Aggregated unread count across all community groups (server-side Firestore).
   */
  @Get('community-unread')
  @UseGuards(AuthGuard)
  async getCommunityUnread(@CurrentUser() userId: string) {
    const unread = await this.meService.getCommunityUnread(userId);
    return {
      success: true,
      data: { unread },
    };
  }
}
