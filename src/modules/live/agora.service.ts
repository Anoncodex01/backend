import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
const { RtcTokenBuilder, RtcRole } = require('agora-token');

@Injectable()
export class AgoraService {
  private appId: string;
  private appCertificate: string;

  constructor(private configService: ConfigService) {
    this.appId = this.configService.get<string>('AGORA_APP_ID', '');
    this.appCertificate = this.configService.get<string>('AGORA_APP_CERTIFICATE', '');

    if (!this.appId || this.appId.length < 10) {
      console.error('❌ AGORA_APP_ID is not set or invalid. Set AGORA_APP_ID in your environment.');
    } else {
      console.log(`✅ Agora App ID configured (${this.appId.substring(0, 4)}...)`);
    }

    if (!this.appCertificate || this.appCertificate.length < 10) {
      console.error('❌ AGORA_APP_CERTIFICATE is not set or invalid. Set AGORA_APP_CERTIFICATE in your environment.');
    } else {
      console.log(`✅ Agora Certificate configured`);
    }
  }

  /**
   * Generate Agora RTC token using official Agora token library
   */
  generateRtcToken(
    channelName: string,
    uid: number | string,
    role: 'publisher' | 'subscriber' = 'subscriber',
    expirationSeconds: number = 3600,
  ): string {
    // Validate inputs
    if (!this.appId || !this.appCertificate) {
      const error = 'Agora App ID or Certificate not configured';
      console.error(`❌ ${error}`);
      throw new Error(error);
    }
    
    if (!channelName) {
      throw new Error('Channel name is required');
    }

    try {
      // Normalize uid - convert string to number, use 0 if invalid (0 means Agora assigns UID)
      const numericUid = typeof uid === 'string' ? (parseInt(uid) || 0) : (uid || 0);

      // Map role to RtcRole enum
      const rtcRole = role === 'publisher' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

      // Agora expects absolute Unix timestamps for expiry, not raw durations.
      const privilegeExpireTs =
        Math.floor(Date.now() / 1000) + expirationSeconds;

      // Generate token using official Agora library
      const token = RtcTokenBuilder.buildTokenWithUid(
        this.appId,
        this.appCertificate,
        channelName,
        numericUid,
        rtcRole,
        privilegeExpireTs,
        privilegeExpireTs,
      );

      console.log(
        `✅ Generated token using official Agora library - channel: ${channelName}, uid: ${numericUid}, role: ${role}, expiresAt: ${privilegeExpireTs}, tokenLength: ${token.length}`,
      );
      
      return token;
    } catch (error) {
      console.error(`❌ Error generating token with official library: ${error}`);
      throw error;
    }
  }

  getAppId(): string {
    return this.appId;
  }
}
