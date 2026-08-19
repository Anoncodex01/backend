import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../../core/firebase/firebase.service';
import { RedisService } from '../../core/redis/redis.service';
import { SupabaseService } from '../../core/supabase/supabase.service';

export interface SessionBootstrap {
  canUseApp: boolean;
  hasInterests: boolean;
  followingIds: string[];
  blockedUserIds: string[];
  notificationUnread: number;
  isBlocked: boolean;
  isFrozen: boolean;
  isDeactivated: boolean;
  blockInfo?: {
    email?: string;
    username?: string;
    full_name?: string;
    blocked_reason?: string;
  };
  freezeInfo?: {
    email?: string;
    username?: string;
    full_name?: string;
  };
}

@Injectable()
export class MeService {
  private bootstrapTtl: number;
  private communityUnreadTtl: number;

  constructor(
    private readonly redisService: RedisService,
    private readonly supabaseService: SupabaseService,
    private readonly firebaseService: FirebaseService,
    private readonly configService: ConfigService,
  ) {
    this.bootstrapTtl = this.configService.get<number>('CACHE_BOOTSTRAP_TTL', 90);
    this.communityUnreadTtl = this.configService.get<number>(
      'CACHE_COMMUNITY_UNREAD_TTL',
      60,
    );
  }

  async getSessionBootstrap(userId: string): Promise<SessionBootstrap> {
    const cacheKey = `me:bootstrap:${userId}`;

    try {
      const cached = await this.redisService.getJson<SessionBootstrap>(cacheKey);
      if (cached) return cached;
    } catch (error) {
      console.warn('Redis bootstrap cache read failed:', error);
    }

    const client = this.supabaseService.getClient();

    const [
      userRow,
      followingIds,
      blockedByMe,
      blockedMe,
      notificationUnread,
    ] = await Promise.all([
      client
        .from('users')
        .select(
          'id,email,username,full_name,is_blocked,blocked_reason,is_frozen,is_deactivated,interests_completed',
        )
        .eq('id', userId)
        .maybeSingle(),
      this.supabaseService.getFollowingIds(userId),
      client.from('blocked_users').select('blocked_user_id').eq('user_id', userId),
      client.from('blocked_users').select('user_id').eq('blocked_user_id', userId),
      this.getNotificationUnreadCount(userId),
    ]);

    const user = userRow.data;
    const blockedUserIds = [
      ...(blockedByMe.data || []).map((r: any) => r.blocked_user_id),
      ...(blockedMe.data || []).map((r: any) => r.user_id),
    ];

    let hasInterests = user?.interests_completed === true;
    if (!hasInterests) {
      const { data: interestRows } = await client
        .from('user_interests')
        .select('id')
        .eq('user_id', userId)
        .limit(1);
      hasInterests = (interestRows?.length ?? 0) > 0;
    }

    const isBlocked = user?.is_blocked === true;
    const isFrozen = user?.is_frozen === true;
    const isDeactivated = user?.is_deactivated === true;

    const bootstrap: SessionBootstrap = {
      canUseApp: !isBlocked && !isFrozen,
      hasInterests,
      followingIds,
      blockedUserIds,
      notificationUnread,
      isBlocked,
      isFrozen,
      isDeactivated,
      ...(isBlocked && {
        blockInfo: {
          email: user?.email,
          username: user?.username,
          full_name: user?.full_name,
          blocked_reason: user?.blocked_reason,
        },
      }),
      ...(isFrozen && {
        freezeInfo: {
          email: user?.email,
          username: user?.username,
          full_name: user?.full_name,
        },
      }),
    };

    try {
      await this.redisService.setJson(cacheKey, bootstrap, this.bootstrapTtl);
    } catch (error) {
      console.warn('Redis bootstrap cache write failed:', error);
    }

    return bootstrap;
  }

  async invalidateBootstrap(userId: string): Promise<void> {
    try {
      await this.redisService.del(`me:bootstrap:${userId}`);
    } catch (error) {
      console.warn('Redis bootstrap invalidation failed:', error);
    }
  }

  /**
   * Total unread community group messages for the user (Firestore member_counters).
   * Cached in Redis to avoid N+1 Firestore reads from every client on app open.
   */
  async getCommunityUnread(userId: string): Promise<number> {
    const cacheKey = `me:community-unread:${userId}`;

    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached !== null) {
        const parsed = Number.parseInt(cached, 10);
        if (!Number.isNaN(parsed)) return parsed;
      }
    } catch (error) {
      console.warn('Redis community unread cache read failed:', error);
    }

    const total = await this.computeCommunityUnread(userId);

    try {
      await this.redisService.set(
        cacheKey,
        String(total),
        this.communityUnreadTtl,
      );
    } catch (error) {
      console.warn('Redis community unread cache write failed:', error);
    }

    return total;
  }

  async invalidateCommunityUnread(userId: string): Promise<void> {
    try {
      await this.redisService.del(`me:community-unread:${userId}`);
    } catch (error) {
      console.warn('Redis community unread invalidation failed:', error);
    }
  }

  private async computeCommunityUnread(userId: string): Promise<number> {
    if (!this.firebaseService.isFirestoreAvailable()) {
      return 0;
    }

    const client = this.supabaseService.getClient();

    const { data: memberships, error: membershipError } = await client
      .from('community_members')
      .select('community_id')
      .eq('user_id', userId);

    if (membershipError) {
      console.warn('Community membership query failed:', membershipError.message);
      return 0;
    }

    const communityIds = (memberships || [])
      .map((row: { community_id?: string }) => row.community_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (communityIds.length === 0) return 0;

    const { data: groups, error: groupsError } = await client
      .from('community_groups')
      .select('id')
      .in('community_id', communityIds)
      .limit(100);

    if (groupsError) {
      console.warn('Community groups query failed:', groupsError.message);
      return 0;
    }

    const groupIds = (groups || [])
      .map((row: { id?: string }) => row.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (groupIds.length === 0) return 0;

    return this.sumFirestoreUnreadCounters(userId, groupIds);
  }

  private async sumFirestoreUnreadCounters(
    userId: string,
    groupIds: string[],
  ): Promise<number> {
    const db = this.firebaseService.getFirestore();
    let total = 0;

    const batchSize = 100;
    for (let i = 0; i < groupIds.length; i += batchSize) {
      const batch = groupIds.slice(i, i + batchSize);
      const refs = batch.map((groupId) =>
        db
          .collection('group_messages')
          .doc(groupId)
          .collection('member_counters')
          .doc(userId),
      );

      try {
        const snapshots = await db.getAll(...refs);
        for (const snap of snapshots) {
          const unreadCount = snap.data()?.unreadCount;
          if (typeof unreadCount === 'number' && unreadCount > 0) {
            total += unreadCount;
          }
        }
      } catch (error) {
        console.warn('Firestore community unread batch failed:', error);
      }
    }

    return total;
  }

  private async getNotificationUnreadCount(userId: string): Promise<number> {
    const client = this.supabaseService.getClient();
    const { count, error } = await client
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      console.warn('Notification unread count failed:', error.message);
      return 0;
    }
    return count ?? 0;
  }
}
