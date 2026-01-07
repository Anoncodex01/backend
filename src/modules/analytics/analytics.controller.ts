import {
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('analytics')
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  /**
   * GET /v1/analytics/me
   * Get current user's analytics
   */
  @Get('me')
  @UseGuards(AuthGuard)
  async getMyAnalytics(@CurrentUser() userId: string) {
    const analytics = await this.analyticsService.getUserAnalytics(userId);

    return {
      success: true,
      data: analytics,
    };
  }

  /**
   * GET /v1/analytics/user/:id
   * Get user analytics (public stats)
   */
  @Get('user/:id')
  async getUserAnalytics(@Param('id') userId: string) {
    const analytics = await this.analyticsService.getUserAnalytics(userId);

    return {
      success: true,
      data: analytics,
    };
  }

  /**
   * GET /v1/analytics/post/:id
   * Get post analytics
   */
  @Get('post/:id')
  async getPostAnalytics(@Param('id') postId: string) {
    const analytics = await this.analyticsService.getPostAnalytics(postId);

    return {
      success: true,
      data: analytics,
    };
  }

  /**
   * GET /v1/analytics/platform
   * Get platform-wide analytics (requires admin)
   */
  @Get('platform')
  @UseGuards(AuthGuard)
  async getPlatformAnalytics() {
    const analytics = await this.analyticsService.getPlatformAnalytics();

    return {
      success: true,
      data: analytics,
    };
  }
}

