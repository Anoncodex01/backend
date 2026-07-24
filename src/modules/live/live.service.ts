import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import * as admin from 'firebase-admin';
import { RedisService } from '../../core/redis/redis.service';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { FirebaseService } from '../../core/firebase/firebase.service';
import { AgoraService } from './agora.service';
import { NotificationsService } from '../notifications/notifications.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LiveService {
  private readonly logger = new Logger(LiveService.name);
  private readonly staleHostTimeoutMs = 90_000;
  private readonly blockedLiveTitleKeywords = [
    'child porn',
    'child sex',
    'underage sex',
    'rape',
    'incest',
    'bestiality',
    'sex tape',
    'kill yourself',
    'suicide challenge',
    'beheading',
    'terror attack',
    'terrorist attack',
    'nude',
    'naked',
    'porn',
    'xxx',
    'nsfw',
    'escort',
    'hookup',
    'drug dealer',
    'cocaine',
    'meth',
    'weed',
    'marijuana',
    'gun',
    'fight club',
    'bloodshed',
    'betting slip',
    'casino hack',
    'fuck you',
    'bitch',
    'slut',
    'whore',
    'nigger',
    'rape you',
    'nitakuua',
    'nakubaka',
    'malaya',
    'umbwa',
    'ngono',
  ];

  constructor(
    private redisService: RedisService,
    private supabaseService: SupabaseService,
    private firebaseService: FirebaseService,
    private agoraService: AgoraService,
    private notificationsService: NotificationsService,
    private configService: ConfigService,
  ) {}

  private assertAdminSecret(secret?: string) {
    const expected =
      this.configService.get<string>('SUPPORT_ADMIN_SECRET', '') ||
      this.configService.get<string>('ADMIN_SECRET', '');

    if (!expected || secret !== expected) {
      throw new ForbiddenException('Invalid admin secret');
    }
  }

  private async clearActiveSessionsCache() {
    try {
      await this.redisService.del('live:active_sessions');
    } catch {
      // ignore cache clear failures
    }
  }

  private mapFirestoreLiveDoc(doc: admin.firestore.QueryDocumentSnapshot) {
    const data = doc.data();
    const startedAt =
      data.startedAt?.toDate?.()?.toISOString?.() ?? data.startedAt ?? null;
    const hostLastSeenAt =
      data.hostLastSeenAt?.toDate?.()?.toISOString?.() ??
      data.hostLastSeenAt ??
      null;
    const referenceTime = hostLastSeenAt
      ? new Date(hostLastSeenAt).getTime()
      : startedAt
        ? new Date(startedAt).getTime()
        : null;
    const timeoutMs = data.mode === 'voice' ? 300_000 : this.staleHostTimeoutMs;
    const isStale =
      referenceTime != null && Date.now() - referenceTime > timeoutMs;

    return {
      id: doc.id,
      ...data,
      startedAt,
      hostLastSeenAt,
      isStale,
    };
  }

  private normalizeText(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private validateLiveTitle(title?: string) {
    const normalized = this.normalizeText(title || '');
    if (!normalized) return;

    const matched = this.blockedLiveTitleKeywords.filter((keyword) =>
      normalized.includes(keyword),
    );

    if (matched.length > 0) {
      throw new Error(
        'This live title appears to violate community guidelines. Please edit it and try again.',
      );
    }
  }

  private buildAgoraUid(userId: string) {
    const normalized = (userId || '').replace(/[^a-fA-F0-9]/g, '');
    if (normalized.length >= 8) {
      const parsed = parseInt(normalized.slice(-8), 16);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed % 2147483646 || 1;
      }
    }

    let hash = 0;
    for (let i = 0; i < userId.length; i += 1) {
      hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 2147483646 || 1;
  }

  @Cron('*/30 * * * * *')
  async cleanupStaleFirestoreLiveSessions() {
    try {
      const firestore = this.firebaseService.getFirestore();
      const snapshot = await firestore
        .collection('live_sessions')
        .where('isLive', '==', true)
        .where('endedAt', '==', null)
        .limit(100)
        .get();

      if (snapshot.empty) return;

      const now = Date.now();
      let cleaned = 0;

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const hostLastSeenAt = data.hostLastSeenAt?.toDate?.();
        const startedAt = data.startedAt?.toDate?.();
        const referenceTime = hostLastSeenAt ?? startedAt;

        if (!referenceTime) continue;
        const timeoutMs = data.mode === 'voice' ? 300_000 : this.staleHostTimeoutMs;
        if (now - referenceTime.getTime() <= timeoutMs) continue;

        const didClean = await firestore.runTransaction(async (transaction) => {
          const latestSnapshot = await transaction.get(doc.ref);
          const latest = latestSnapshot.data();
          if (!latest || latest.isLive !== true || latest.endedAt != null) {
            return false;
          }
          const latestHeartbeat =
            latest.hostLastSeenAt?.toDate?.() ?? latest.startedAt?.toDate?.();
          const latestTimeoutMs =
            latest.mode === 'voice' ? 300_000 : this.staleHostTimeoutMs;
          if (
            !latestHeartbeat ||
            Date.now() - latestHeartbeat.getTime() <= latestTimeoutMs
          ) {
            return false;
          }
          transaction.set(
            doc.ref,
            {
              isLive: false,
              hostOnline: false,
              endedAt: admin.firestore.FieldValue.serverTimestamp(),
              endedReason: 'host_timeout',
              viewerCount: 0,
            },
            { merge: true },
          );
          return true;
        });
        if (didClean) {
          cleaned++;
          const agoraChannel = doc.data()?.agoraChannel ?? doc.data()?.channelName;
          if (agoraChannel) {
            this.supabaseService.endLiveSessionByChannel(agoraChannel).catch((e) =>
              this.logger.warn('Supabase sync failed for channel ' + agoraChannel + ': ' + e),
            );
          }
        }
      }

      if (cleaned === 0) return;

      this.logger.warn(`Cleaned up ${cleaned} stale Firestore live session(s)`);
    } catch (error) {
      this.logger.warn(`Stale Firestore live cleanup skipped: ${error}`);
    }
  }

  @Cron('0 */10 * * * *')
  async cleanupStaleSupabaseLiveSessions() {
    try {
      const twoHours = 2 * 60 * 60 * 1000;
      const ended = await this.supabaseService.endStaleSupabaseLiveSessions(twoHours);
      if (ended > 0) {
        this.logger.warn('Cleaned up ' + ended + ' stale Supabase live session(s)');
      }
    } catch (error) {
      this.logger.warn('Supabase stale live cleanup failed: ' + error);
    }
  }

  /**
   * Start a new live session
   */
  async startLiveSession(data: { hostId: string; title?: string }) {
    this.validateLiveTitle(data.title);
    const channelName = `live_${uuidv4().substring(0, 8)}`;
    const hostAgoraUid = this.buildAgoraUid(data.hostId);

    // Generate Agora tokens
    const hostToken = this.agoraService.generateRtcToken(
      channelName,
      hostAgoraUid,
      'publisher',
      86400, // 24 hours
    );

    // Create session in database
    const session = await this.supabaseService.createLiveSession({
      hostId: data.hostId,
      channelName,
      title: data.title,
    });

    // Initialize Redis counters
    await this.redisService.set(`live:${session.id}:viewers`, '0');
    await this.redisService.set(`live:${session.id}:hearts`, '0');

    this.notificationsService
      .sendLiveStartNotification({
        hostId: data.hostId,
        liveId: session.id,
        channelName,
        title: data.title,
      })
      .catch((error) =>
        console.error('Error sending live start notification:', error),
      );

    return {
      session,
      channelName,
      token: hostToken,
      uid: hostAgoraUid,
      appId: this.agoraService.getAppId(),
    };
  }

  /**
   * Join a live session as viewer
   */
  async joinLiveSession(data: { sessionId: string; userId: string }) {
    // Get session from cache or database
    const cacheKey = `live:${data.sessionId}:info`;
    let session = await this.redisService.getJson<any>(cacheKey);

    if (!session) {
      // Fetch from database (you'd implement this)
      // For now, we'll just use what we have
    }

    const viewerAgoraUid = this.buildAgoraUid(data.userId);

    // Generate viewer token
    const token = this.agoraService.generateRtcToken(
      session?.channel_name || '',
      viewerAgoraUid,
      'subscriber',
      7200, // 2 hours
    );

    // Add to viewers set
    await this.redisService.sadd(
      `live:${data.sessionId}:viewer_set`,
      data.userId,
    );

    // Update viewer count
    const viewerCount = await this.redisService.scard(
      `live:${data.sessionId}:viewer_set`,
    );
    await this.redisService.set(
      `live:${data.sessionId}:viewers`,
      viewerCount.toString(),
    );

    return {
      token,
      uid: viewerAgoraUid,
      appId: this.agoraService.getAppId(),
      channelName: session?.channel_name,
      viewerCount,
    };
  }

  /**
   * Leave a live session
   */
  async leaveLiveSession(sessionId: string, userId: string) {
    // Remove from viewers set
    await this.redisService.srem(`live:${sessionId}:viewer_set`, userId);

    // Update viewer count
    const viewerCount = await this.redisService.scard(
      `live:${sessionId}:viewer_set`,
    );
    await this.redisService.set(
      `live:${sessionId}:viewers`,
      viewerCount.toString(),
    );

    return { viewerCount };
  }

  /**
   * End a live session
   */
  async endLiveSession(sessionId: string, hostId: string) {
    // Update database
    await this.supabaseService.endLiveSession(sessionId);

    // Get final counts
    const viewerCount = await this.redisService.get(
      `live:${sessionId}:viewers`,
    );
    const heartCount = await this.redisService.get(`live:${sessionId}:hearts`);

    // Clean up Redis
    await this.redisService.del(`live:${sessionId}:viewers`);
    await this.redisService.del(`live:${sessionId}:hearts`);
    await this.redisService.del(`live:${sessionId}:viewer_set`);
    await this.redisService.del(`live:${sessionId}:info`);

    return {
      finalViewerCount: parseInt(viewerCount || '0'),
      finalHeartCount: parseInt(heartCount || '0'),
    };
  }

  /**
   * Send a heart (with rate limiting)
   */
  async sendHeart(
    sessionId: string,
    userId: string,
  ): Promise<{ allowed: boolean; heartCount: number }> {
    // Rate limit: max 5 hearts per second per user
    const rateLimitKey = `live:${sessionId}:heart_limit:${userId}`;
    const allowed = await this.redisService.rateLimit(rateLimitKey, 5, 1);

    if (!allowed) {
      const heartCount = parseInt(
        (await this.redisService.get(`live:${sessionId}:hearts`)) || '0',
      );
      return { allowed: false, heartCount };
    }

    // Increment heart count
    const heartCount = await this.redisService.incr(`live:${sessionId}:hearts`);

    return { allowed: true, heartCount };
  }

  /**
   * Get live session state
   */
  async getLiveState(sessionId: string) {
    const [viewers, hearts] = await Promise.all([
      this.redisService.get(`live:${sessionId}:viewers`),
      this.redisService.get(`live:${sessionId}:hearts`),
    ]);

    return {
      viewerCount: parseInt(viewers || '0'),
      heartCount: parseInt(hearts || '0'),
    };
  }

  /**
   * Get all active live sessions
   */
  async getActiveLiveSessions() {
    const cacheKey = 'live:active_sessions';

    return this.redisService.getOrSet(
      cacheKey,
      async () => {
        try {
          const firestore = this.firebaseService.getFirestore();
          const snapshot = await firestore
            .collection('live_sessions')
            .where('isLive', '==', true)
            .where('endedAt', '==', null)
            .limit(20)
            .get();

          return snapshot.docs.map((doc) => this.mapFirestoreLiveDoc(doc));
        } catch (firestoreError) {
          this.logger.warn(
            `Firestore live session probe failed, falling back to Supabase: ${firestoreError}`,
          );
        }

        try {
          return await this.supabaseService.getLiveSessions(20);
        } catch (supabaseError: any) {
          const message = String(supabaseError?.message || supabaseError || '');
          if (message.includes('live_sessions') || message.includes('schema cache')) {
            this.logger.warn(
              'Supabase live_sessions table is unavailable; returning no active SQL live sessions',
            );
            return [];
          }
          throw supabaseError;
        }
      },
      10, // Refresh every 10 seconds
    );
  }

  /**
   * Generate Agora RTC token for a channel
   */
  async generateToken(data: {
    channelName: string;
    userId: string;
    isHost: boolean;
  }) {
    const isHost = data.isHost === true;
    // Cache key is unique per user + channel + role so UIDs never collide.
    // TTL is 5 min less than the Agora token expiry so we never serve an
    // already-expired token from cache.
    // v2 intentionally bypasses older cached tokens that may have been issued
    // before host/co-host role handling was corrected.
    const cacheRole = isHost ? 'publisher' : 'subscriber';
    const cacheKey = `live:token:v2:${data.channelName}:${data.userId}:${cacheRole}`;
    const cacheTtl = isHost ? 82800 : 6300; // 23 h for host, 105 min for viewer

    // --- Cache read ---
    try {
      const cached = await this.redisService.getJson<{
        token: string;
        uid: number;
        appId: string;
        channelName: string;
      }>(cacheKey);
      if (cached) {
        this.logger.debug(
          `⚡ Token cache hit: ${data.channelName} (role: ${cacheRole})`,
        );
        return cached;
      }
    } catch {
      // Redis unavailable — fall through and generate fresh token
    }

    // --- Generate ---
    try {
      const role = isHost ? 'publisher' : 'subscriber';
      const expirationSeconds = isHost ? 86400 : 7200;
      const agoraUid = this.buildAgoraUid(data.userId);

      const token = this.agoraService.generateRtcToken(
        data.channelName,
        agoraUid,
        role,
        expirationSeconds,
      );

      const result = {
        token,
        uid: agoraUid,
        appId: this.agoraService.getAppId(),
        channelName: data.channelName,
        role,
      };

      // --- Cache write (non-critical) ---
      try {
        await this.redisService.setJson(cacheKey, result, cacheTtl);
      } catch {
        // Redis write failed — continue without cache
      }

      this.logger.log(
        `✅ Token generated: ${data.channelName} (role: ${role}, uid: ${agoraUid})`,
      );
      return result;
    } catch (error) {
      this.logger.error(`❌ Error generating token: ${error}`);
      throw error;
    }
  }

  async generateAudienceToken(channelName: string) {
    if (!/^live_[A-Za-z0-9_-]+$/.test(channelName)) {
      throw new BadRequestException('Invalid live channel');
    }

    const firestore = this.firebaseService.getFirestore();
    const snapshot = await firestore
      .collection('live_sessions')
      .where('agoraChannel', '==', channelName)
      .limit(1)
      .get();
    const session = snapshot.docs[0]?.data();

    if (!session || session.isLive !== true || session.endedAt != null) {
      throw new NotFoundException('Live stream is no longer active');
    }

    return this.generateToken({
      channelName,
      userId: `audience-${uuidv4()}`,
      isHost: false,
    });
  }

  /**
   * Sync counters to database (call periodically)
   */
  async syncCountersToDatabase(sessionId: string) {
    const state = await this.getLiveState(sessionId);

    await this.supabaseService.updateLiveSession(sessionId, {
      viewerCount: state.viewerCount,
      heartCount: state.heartCount,
    });
  }

  /**
   * Admin: list active lives (fresh Firestore read, no cache).
   */
  async adminListActiveLives(secret?: string) {
    this.assertAdminSecret(secret);

    try {
      const firestore = this.firebaseService.getFirestore();
      const snapshot = await firestore
        .collection('live_sessions')
        .where('isLive', '==', true)
        .where('endedAt', '==', null)
        .limit(100)
        .get();

      const sessions = snapshot.docs.map((doc) => this.mapFirestoreLiveDoc(doc));
      sessions.sort((a, b) => {
        const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
        const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
        return bTime - aTime;
      });

      return {
        sessions,
        activeCount: sessions.length,
        staleCount: sessions.filter((s) => s.isStale).length,
      };
    } catch (firestoreError) {
      this.logger.warn(
        `Admin Firestore live list failed, falling back to Supabase: ${firestoreError}`,
      );
      const sessions = await this.supabaseService.getLiveSessions(100);
      return {
        sessions,
        activeCount: sessions.length,
        staleCount: 0,
      };
    }
  }

  /**
   * Admin: force-end a live session (Firestore source of truth).
   */
  async adminForceEndLive(secret: string | undefined, liveId: string) {
    this.assertAdminSecret(secret);
    if (!liveId?.trim()) {
      throw new BadRequestException('liveId is required');
    }

    const firestore = this.firebaseService.getFirestore();
    const ref = firestore.collection('live_sessions').doc(liveId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new NotFoundException('Live session not found');
    }

    const data = snap.data() || {};
    await ref.set(
      {
        isLive: false,
        hostOnline: false,
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        endedReason: 'ended_by_admin',
        viewerCount: 0,
      },
      { merge: true },
    );

    const agoraChannel =
      (data.agoraChannel as string | undefined) ||
      (data.channelName as string | undefined) ||
      `live_${liveId}`;

    try {
      await this.supabaseService.endLiveSessionByChannel(agoraChannel);
    } catch (e) {
      this.logger.warn(
        `Supabase sync failed while admin force-ending ${liveId}: ${e}`,
      );
    }

    try {
      await this.redisService.del(`live:${liveId}:viewers`);
      await this.redisService.del(`live:${liveId}:hearts`);
      await this.redisService.del(`live:${liveId}:viewer_set`);
      await this.redisService.del(`live:${liveId}:info`);
    } catch {
      // ignore redis cleanup failures
    }

    await this.clearActiveSessionsCache();

    this.logger.warn(`Admin force-ended live session ${liveId}`);
    return {
      id: liveId,
      agoraChannel,
      endedReason: 'ended_by_admin',
    };
  }

  /**
   * Admin: enable/disable comments on an active live.
   */
  async adminSetCommentsEnabled(
    secret: string | undefined,
    liveId: string,
    commentsEnabled: boolean,
  ) {
    this.assertAdminSecret(secret);
    if (!liveId?.trim()) {
      throw new BadRequestException('liveId is required');
    }

    const firestore = this.firebaseService.getFirestore();
    const ref = firestore.collection('live_sessions').doc(liveId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new NotFoundException('Live session not found');
    }

    await ref.set({ commentsEnabled: !!commentsEnabled }, { merge: true });
    await this.clearActiveSessionsCache();

    return {
      id: liveId,
      commentsEnabled: !!commentsEnabled,
    };
  }
}
