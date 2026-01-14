import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

// Agora RTC Token Privileges
const Privileges = {
  kJoinChannel: 1,
  kPublishAudioStream: 2,
  kPublishVideoStream: 3,
  kPublishDataStream: 4,
};

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
   * Generate Agora RTC token using AccessToken2 format
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

    const version = '007';
    const ts = Math.floor(Date.now() / 1000);
    // Use Math.random for better compatibility (randomInt might not be available in older Node versions)
    const salt = Math.floor(Math.random() * 0xFFFFFFFF);
    const privilegeExpiredTs = ts + expirationSeconds;

    // Normalize uid - convert string to number, use 0 if invalid (0 means Agora assigns UID)
    const numericUid = typeof uid === 'string' ? (parseInt(uid) || 0) : (uid || 0);

    // Build privileges map - ORDER MATTERS (Map maintains insertion order)
    const privileges = new Map<number, number>();
    privileges.set(Privileges.kJoinChannel, privilegeExpiredTs);

    if (role === 'publisher') {
      privileges.set(Privileges.kPublishAudioStream, privilegeExpiredTs);
      privileges.set(Privileges.kPublishVideoStream, privilegeExpiredTs);
      privileges.set(Privileges.kPublishDataStream, privilegeExpiredTs);
    }

    // Build message: salt (uint32) + ts (uint32) + privileges
    const saltBuf = this.packUint32(salt);
    const tsBuf = this.packUint32(ts);
    const privilegesBuf = this.packPrivileges(privileges);
    const message = Buffer.concat([saltBuf, tsBuf, privilegesBuf]);

    // Generate signature: HMAC-SHA256(appCertificate, appId + channelName + uid + message)
    // For uid 0, use empty string in signature calculation (per Agora spec)
    const uidStr = numericUid === 0 ? '' : numericUid.toString();
    
    // Concatenate strings first, then encode (matches Agora spec exactly)
    const signString = this.appId + channelName + uidStr;
    const signBuf = Buffer.from(signString, 'utf8');
    const toSign = Buffer.concat([signBuf, message]);

    const signature = crypto
      .createHmac('sha256', this.appCertificate)
      .update(toSign)
      .digest();

    // Build content: appId (string) + signature_length (uint16) + signature + message_length (uint16) + message
    const appIdBuf = this.packString(this.appId);
    const sigLenBuf = this.packUint16(signature.length);
    const msgLenBuf = this.packUint16(message.length);
    const content = Buffer.concat([appIdBuf, sigLenBuf, signature, msgLenBuf, message]);

    // Return: version (007) + base64(content)
    const token = version + content.toString('base64');
    
    console.log(`✅ Generated token for channel: ${channelName}, uid: ${numericUid}, role: ${role}, expires: ${expirationSeconds}s, tokenLength: ${token.length}`);
    
    return token;
  }

  private packUint16(value: number): Buffer {
    const buf = Buffer.alloc(2);
    buf.writeUInt16LE(value);
    return buf;
  }

  private packUint32(value: number): Buffer {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(value);
    return buf;
  }

  private packString(str: string): Buffer {
    const strBuf = Buffer.from(str, 'utf8');
    const lenBuf = this.packUint16(strBuf.length);
    return Buffer.concat([lenBuf, strBuf]);
  }

  private packPrivileges(privileges: Map<number, number>): Buffer {
    const parts: Buffer[] = [];
    
    // Pack privilege count
    parts.push(this.packUint16(privileges.size));
    
    // Pack each privilege: key (uint16) + value (uint32)
    // IMPORTANT: Must iterate in insertion order (Map maintains insertion order in JS/TS)
    const privilegeEntries = Array.from(privileges.entries());
    for (const [key, value] of privilegeEntries) {
      parts.push(this.packUint16(key));
      parts.push(this.packUint32(value));
    }
    
    return Buffer.concat(parts);
  }

  getAppId(): string {
    return this.appId;
  }
}
