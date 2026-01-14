import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
const { RtcTokenBuilder, RtcRole } = require('agora-token');

@Injectable()
export class AgoraService {
  private appId: string;
  private appCertificate: string;

  constructor(private configService: ConfigService) {
    // Get App ID - should be: 8ef13bee068a4154871a389a56caffe5
    this.appId = this.configService.get('AGORA_APP_ID') || '8ef13bee068a4154871a389a56caffe5';
    
    // Get Certificate - use fallback from Supabase function if not in env
    // Fallback certificate: 7bf012ab53904bd48030a1e4b0a796f4
    this.appCertificate = this.configService.get('AGORA_APP_CERTIFICATE') || '7bf012ab53904bd48030a1e4b0a796f4';
    
    // Validate configuration on startup
    console.log(`📋 Agora Configuration:`);
    console.log(`   App ID: ${this.appId.substring(0, 8)}...${this.appId.substring(this.appId.length - 4)}`);
    console.log(`   Certificate: ${this.appCertificate.substring(0, 8)}...${this.appCertificate.substring(this.appCertificate.length - 4)} (${this.appCertificate.length} chars)`);
    
    if (!this.appId || this.appId.length < 10) {
      console.error('❌ AGORA_APP_ID is invalid!');
    } else {
      console.log(`✅ Agora App ID configured`);
    }
    
    if (!this.appCertificate || this.appCertificate.length < 10) {
      console.error('❌ AGORA_APP_CERTIFICATE is invalid!');
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

      // Generate token using official Agora library
      // Parameters are durations in seconds (not absolute timestamps)
      const token = RtcTokenBuilder.buildTokenWithUid(
        this.appId,
        this.appCertificate,
        channelName,
        numericUid,
        rtcRole,
        expirationSeconds, // tokenExpire: duration in seconds
        expirationSeconds, // privilegeExpire: duration in seconds
      );

      console.log(`✅ Generated token using official Agora library - channel: ${channelName}, uid: ${numericUid}, role: ${role}, expires: ${expirationSeconds}s, tokenLength: ${token.length}`);
      
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
