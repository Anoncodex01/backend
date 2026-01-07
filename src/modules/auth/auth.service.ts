import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../../core/firebase/firebase.service';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { RedisService } from '../../core/redis/redis.service';

interface JwtPayload {
  sub: string;
  email?: string;
  role?: string;
  aud?: string;
  exp?: number;
}

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private firebaseService: FirebaseService,
    private supabaseService: SupabaseService,
    private redisService: RedisService,
  ) {}

  /**
   * Verify Supabase JWT and return user info
   */
  async verifySupabaseToken(token: string): Promise<JwtPayload> {
    try {
      const secret = this.configService.get('SUPABASE_JWT_SECRET');
      const payload = this.jwtService.verify(token, { secret });
      return payload;
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Get Firebase custom token for a Supabase user
   * This is the critical endpoint that fixes Firestore permission-denied errors
   */
  async getFirebaseToken(supabaseUserId: string): Promise<{ token: string | null; expiresIn: number; error?: string }> {
    // Check cache first
    const cacheKey = `firebase_token:${supabaseUserId}`;
    const cachedToken = await this.redisService.get(cacheKey);
    
    if (cachedToken) {
      const ttl = await this.redisService.ttl(cacheKey);
      return { token: cachedToken, expiresIn: ttl };
    }

    // Get user info for claims
    let userClaims: Record<string, any> = {};
    try {
      const user = await this.supabaseService.getUser(supabaseUserId);
      if (user) {
        userClaims = {
          username: user.username,
          displayName: user.full_name,
          profileImage: user.profile_image_url,
        };
      }
    } catch (error) {
      // Continue without claims
    }

    // Create Firebase custom token
    const token = await this.firebaseService.createCustomToken(supabaseUserId, userClaims);

    if (!token) {
      return { token: null, expiresIn: 0, error: 'Firebase not configured on server' };
    }

    // Cache for 55 minutes (Firebase tokens expire in 1 hour)
    const expiresIn = 55 * 60;
    await this.redisService.set(cacheKey, token, expiresIn);

    return { token, expiresIn };
  }

  /**
   * Get user profile with caching
   */
  async getUserProfile(userId: string) {
    const cacheKey = `user:${userId}`;
    
    return this.redisService.getOrSet(
      cacheKey,
      () => this.supabaseService.getUser(userId),
      60, // Cache for 60 seconds
    );
  }

  /**
   * Invalidate user cache
   */
  async invalidateUserCache(userId: string) {
    await this.redisService.del(`user:${userId}`);
    await this.redisService.del(`firebase_token:${userId}`);
  }

  /**
   * Store FCM token for push notifications
   */
  async storeFcmToken(userId: string, fcmToken: string, deviceId: string) {
    const key = `fcm_tokens:${userId}`;
    await this.redisService.hset(key, deviceId, fcmToken);
    await this.redisService.expire(key, 30 * 24 * 60 * 60); // 30 days
  }

  /**
   * Get all FCM tokens for a user
   */
  async getFcmTokens(userId: string): Promise<string[]> {
    const key = `fcm_tokens:${userId}`;
    const tokens = await this.redisService.hgetall(key);
    return Object.values(tokens);
  }

  /**
   * Remove FCM token
   */
  async removeFcmToken(userId: string, deviceId: string) {
    const key = `fcm_tokens:${userId}`;
    await this.redisService.hdel(key, deviceId);
  }
}

