import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../core/redis/redis.service';
import { SupabaseService } from '../../core/supabase/supabase.service';

@Injectable()
export class CommunitiesService {
  private listTtl: number;
  private detailTtl: number;

  constructor(
    private redisService: RedisService,
    private supabaseService: SupabaseService,
    private configService: ConfigService,
  ) {
    // Community list cache for 5 minutes, details for 3 minutes
    this.listTtl = this.configService.get('CACHE_COMMUNITY_LIST_TTL', 300);
    this.detailTtl = this.configService.get('CACHE_COMMUNITY_DETAIL_TTL', 180);
  }

  /**
   * Get list of communities with caching
   */
  async getCommunities(options: {
    limit?: number;
    offset?: number;
    userId?: string;
  } = {}) {
    const limit = options.limit || 20;
    const offset = options.offset || 0;
    const cacheKey = `communities:list:${offset}:${limit}`;

    let communities = await this.redisService.getJson<any[]>(cacheKey);

    if (!communities) {
      communities = await this.supabaseService.getCommunities(limit, offset);
      await this.redisService.setJson(cacheKey, communities, this.listTtl);
    }

    // Enrich with membership status if user is logged in
    if (options.userId && communities.length > 0) {
      communities = await this.enrichWithMembership(communities, options.userId);
    }

    return communities;
  }

  /**
   * Get single community with caching
   */
  async getCommunity(communityId: string, userId?: string) {
    const cacheKey = `community:${communityId}`;

    let community = await this.redisService.getJson<any>(cacheKey);

    if (!community) {
      community = await this.supabaseService.getCommunity(communityId);
      if (community) {
        await this.redisService.setJson(cacheKey, community, this.detailTtl);
      }
    }

    // Enrich with membership status
    if (community && userId) {
      const isMember = await this.isMember(communityId, userId);
      community = { ...community, is_member: isMember };
    }

    return community;
  }

  /**
   * Check if user is a member of community (cached)
   */
  async isMember(communityId: string, userId: string): Promise<boolean> {
    const cacheKey = `community:member:${communityId}:${userId}`;

    const cached = await this.redisService.get(cacheKey);
    if (cached !== null) {
      return cached === 'true';
    }

    const isMember = await this.supabaseService.isCommunityMember(communityId, userId);
    await this.redisService.set(cacheKey, isMember ? 'true' : 'false', this.detailTtl);

    return isMember;
  }

  /**
   * Enrich communities with membership status
   */
  private async enrichWithMembership(communities: any[], userId: string) {
    const membershipPromises = communities.map(c =>
      this.isMember(c.id, userId).then(isMember => ({ ...c, is_member: isMember }))
    );
    return Promise.all(membershipPromises);
  }

  /**
   * Invalidate community cache (after join/leave/update)
   */
  async invalidateCommunity(communityId: string, userId?: string) {
    await this.redisService.del(`community:${communityId}`);
    await this.redisService.deletePattern('communities:list:*');
    
    if (userId) {
      await this.redisService.del(`community:member:${communityId}:${userId}`);
    }
  }

  /**
   * Invalidate user's community membership cache
   */
  async invalidateMembership(communityId: string, userId: string) {
    await this.redisService.del(`community:member:${communityId}:${userId}`);
    await this.redisService.del(`community:${communityId}`);
  }
}

