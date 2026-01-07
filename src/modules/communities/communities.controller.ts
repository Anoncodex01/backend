import {
  Controller,
  Get,
  Param,
  Query,
  Headers,
} from '@nestjs/common';
import { CommunitiesService } from './communities.service';
import { AuthService } from '../auth/auth.service';

@Controller('communities')
export class CommunitiesController {
  constructor(
    private communitiesService: CommunitiesService,
    private authService: AuthService,
  ) {}

  /**
   * GET /v1/communities
   * Get list of communities (cached)
   */
  @Get()
  async getCommunities(
    @Query('limit') limit: number = 20,
    @Query('offset') offset: number = 0,
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

    const communities = await this.communitiesService.getCommunities({
      limit,
      offset,
      userId,
    });

    return {
      success: true,
      data: communities,
      meta: {
        limit,
        offset,
        count: communities.length,
        hasMore: communities.length === limit,
      },
    };
  }

  /**
   * GET /v1/communities/:id
   * Get single community (cached)
   */
  @Get(':id')
  async getCommunity(
    @Param('id') communityId: string,
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

    const community = await this.communitiesService.getCommunity(communityId, userId);

    if (!community) {
      return {
        success: false,
        message: 'Community not found',
      };
    }

    return {
      success: true,
      data: community,
    };
  }
}

