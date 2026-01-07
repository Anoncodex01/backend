import { Injectable } from '@nestjs/common';
import { RedisService } from '../../core/redis/redis.service';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { AgoraService } from './agora.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LiveService {
  constructor(
    private redisService: RedisService,
    private supabaseService: SupabaseService,
    private agoraService: AgoraService,
  ) {}

  /**
   * Start a new live session
   */
  async startLiveSession(data: {
    hostId: string;
    title?: string;
  }) {
    const channelName = `live_${uuidv4().substring(0, 8)}`;

    // Generate Agora tokens
    const hostToken = this.agoraService.generateRtcToken(
      channelName,
      data.hostId,
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

    return {
      session,
      channelName,
      token: hostToken,
      appId: this.agoraService.getAppId(),
    };
  }

  /**
   * Join a live session as viewer
   */
  async joinLiveSession(data: {
    sessionId: string;
    userId: string;
  }) {
    // Get session from cache or database
    const cacheKey = `live:${data.sessionId}:info`;
    let session = await this.redisService.getJson<any>(cacheKey);

    if (!session) {
      // Fetch from database (you'd implement this)
      // For now, we'll just use what we have
    }

    // Generate viewer token
    const token = this.agoraService.generateRtcToken(
      session?.channel_name || '',
      data.userId,
      'subscriber',
      7200, // 2 hours
    );

    // Add to viewers set
    await this.redisService.sadd(`live:${data.sessionId}:viewer_set`, data.userId);

    // Update viewer count
    const viewerCount = await this.redisService.scard(`live:${data.sessionId}:viewer_set`);
    await this.redisService.set(`live:${data.sessionId}:viewers`, viewerCount.toString());

    return {
      token,
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
    const viewerCount = await this.redisService.scard(`live:${sessionId}:viewer_set`);
    await this.redisService.set(`live:${sessionId}:viewers`, viewerCount.toString());

    return { viewerCount };
  }

  /**
   * End a live session
   */
  async endLiveSession(sessionId: string, hostId: string) {
    // Update database
    await this.supabaseService.endLiveSession(sessionId);

    // Get final counts
    const viewerCount = await this.redisService.get(`live:${sessionId}:viewers`);
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
  async sendHeart(sessionId: string, userId: string): Promise<{ allowed: boolean; heartCount: number }> {
    // Rate limit: max 5 hearts per second per user
    const rateLimitKey = `live:${sessionId}:heart_limit:${userId}`;
    const allowed = await this.redisService.rateLimit(rateLimitKey, 5, 1);

    if (!allowed) {
      const heartCount = parseInt(await this.redisService.get(`live:${sessionId}:hearts`) || '0');
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
      () => this.supabaseService.getLiveSessions(20),
      10, // Refresh every 10 seconds
    );
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
}

