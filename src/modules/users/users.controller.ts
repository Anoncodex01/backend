import {
  Controller,
  Get,
  Param,
  Query,
  Headers,
  Post,
  UseGuards,
  ParseBoolPipe,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private authService: AuthService,
  ) {}

  // ===== IMPORTANT: Specific routes MUST come BEFORE parameterized routes =====

  /**
   * GET /v1/users/me
   * Get current user's profile (authenticated)
   */
  @Get('me')
  @UseGuards(AuthGuard)
  async getMyProfile(@CurrentUser() user: any) {
    const profile = await this.usersService.getProfile(user.sub);

    return {
      success: true,
      data: profile,
    };
  }

  /**
   * POST /v1/users/delete-account
   * Anonymize account (delete PII, keep records for audit). Google Play compliance.
   */
  @Post('delete-account')
  @UseGuards(AuthGuard)
  async deleteAccount(@CurrentUser() user: any) {
    await this.usersService.anonymizeAccount(user.sub);
    return {
      success: true,
      message: 'Account has been deleted. You have been signed out.',
    };
  }

  /**
   * GET /v1/users/username/:username
   * Get user profile by username (cached)
   */
  @Get('username/:username')
  async getProfileByUsername(
    @Param('username') username: string,
    @Headers('authorization') authHeader?: string,
  ) {
    let currentUserId: string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.replace('Bearer ', '');
        const payload = await this.authService.verifySupabaseToken(token);
        currentUserId = payload.sub;
      } catch {
        // Continue as anonymous
      }
    }

    const profile = await this.usersService.getProfileByUsername(username, currentUserId);

    if (!profile) {
      return {
        success: false,
        message: 'User not found',
      };
    }

    return {
      success: true,
      data: profile,
    };
  }

  /**
   * GET /v1/users/:id/posts
   * Get user's posts (cached)
   */
  @Get(':id/posts')
  async getUserPosts(
    @Param('id') userId: string,
    @Query('limit') limit: number = 20,
    @Query('offset') offset: number = 0,
    @Query('public') isPublic: string = 'true',
    @Query('videoOnly', new ParseBoolPipe({ optional: true })) videoOnly?: boolean,
    @Headers('authorization') authHeader?: string,
  ) {
    let requestingUserId: string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.replace('Bearer ', '');
        const payload = await this.authService.verifySupabaseToken(token);
        requestingUserId = payload.sub;
      } catch {
        // Continue as anonymous
      }
    }

    const publicOnly = isPublic === 'true' || requestingUserId !== userId;

    const posts = await this.usersService.getUserPosts(userId, {
      limit,
      offset,
      isPublic: publicOnly,
      videoOnly: videoOnly ?? false,
    });

    return {
      success: true,
      data: posts,
      meta: {
        userId,
        limit,
        offset,
        videoOnly: videoOnly ?? false,
        count: posts.length,
        hasMore: posts.length === limit,
      },
    };
  }

  /**
   * GET /v1/users/:id/followers
   * Get user's followers (cached)
   */
  @Get(':id/followers')
  async getFollowers(
    @Param('id') userId: string,
    @Query('limit') limit: number = 20,
    @Query('offset') offset: number = 0,
  ) {
    const followers = await this.usersService.getFollowers(userId, limit, offset);

    return {
      success: true,
      data: followers,
      meta: {
        userId,
        limit,
        offset,
        count: followers.length,
        hasMore: followers.length === limit,
      },
    };
  }

  /**
   * GET /v1/users/:id/following
   * Get users the user is following (cached)
   */
  @Get(':id/following')
  async getFollowing(
    @Param('id') userId: string,
    @Query('limit') limit: number = 20,
    @Query('offset') offset: number = 0,
  ) {
    const following = await this.usersService.getFollowing(userId, limit, offset);

    return {
      success: true,
      data: following,
      meta: {
        userId,
        limit,
        offset,
        count: following.length,
        hasMore: following.length === limit,
      },
    };
  }

  /**
   * POST /v1/users/:id/invalidate
   * Force invalidate user cache (internal use)
   */
  @Post(':id/invalidate')
  @UseGuards(AuthGuard)
  async invalidateCache(
    @Param('id') userId: string,
    @CurrentUser() user: any,
  ) {
    // Only allow invalidating own cache
    if (user.sub !== userId) {
      return {
        success: false,
        message: 'Unauthorized',
      };
    }

    await this.usersService.invalidateProfile(userId);

    return {
      success: true,
      message: 'Cache invalidated',
    };
  }

  // ===== Parameterized route LAST (catches :id) =====

  /**
   * GET /v1/users/:id
   * Get user profile by ID (cached)
   */
  @Get(':id')
  async getProfile(
    @Param('id') userId: string,
    @Headers('authorization') authHeader?: string,
  ) {
    // Extract current user ID if authenticated
    let currentUserId: string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.replace('Bearer ', '');
        const payload = await this.authService.verifySupabaseToken(token);
        currentUserId = payload.sub;
      } catch {
        // Continue as anonymous
      }
    }

    const profile = await this.usersService.getProfile(userId, currentUserId);

    if (!profile) {
      return {
        success: false,
        message: 'User not found',
      };
    }

    return {
      success: true,
      data: profile,
    };
  }
}
