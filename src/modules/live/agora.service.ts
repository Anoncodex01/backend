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
    this.appId = this.configService.get('AGORA_APP_ID') || '';
    this.appCertificate = this.configService.get('AGORA_APP_CERTIFICATE') || '';
  }

  /**
   * Generate Agora RTC token
   */
  generateRtcToken(
    channelName: string,
    uid: number | string,
    role: 'publisher' | 'subscriber' = 'subscriber',
    expirationSeconds: number = 3600,
  ): string {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationSeconds;

    // Build token
    const tokenVersion = '007';
    const uidStr = typeof uid === 'number' ? uid.toString() : uid;

    // Create privileges map
    const privileges: Record<number, number> = {};
    privileges[Privileges.kJoinChannel] = privilegeExpiredTs;

    if (role === 'publisher') {
      privileges[Privileges.kPublishAudioStream] = privilegeExpiredTs;
      privileges[Privileges.kPublishVideoStream] = privilegeExpiredTs;
      privileges[Privileges.kPublishDataStream] = privilegeExpiredTs;
    }

    // Generate token using AccessToken2 algorithm
    const token = this.buildToken(
      this.appId,
      this.appCertificate,
      channelName,
      uidStr,
      privileges,
      currentTimestamp,
      privilegeExpiredTs,
    );

    return token;
  }

  private buildToken(
    appId: string,
    appCertificate: string,
    channelName: string,
    uid: string,
    privileges: Record<number, number>,
    issueTs: number,
    expireTs: number,
  ): string {
    const m = this.packContent(issueTs, appId, channelName, uid, privileges);
    const signature = this.sign(appCertificate, m);
    const content = Buffer.concat([signature, m]);
    
    return '007' + Buffer.from(content).toString('base64');
  }

  private packContent(
    issueTs: number,
    appId: string,
    channelName: string,
    uid: string,
    privileges: Record<number, number>,
  ): Buffer {
    const buffers: Buffer[] = [];

    // Pack issue timestamp
    buffers.push(this.packUint32(issueTs));

    // Pack salt (random)
    const salt = crypto.randomInt(0, 0xFFFFFFFF);
    buffers.push(this.packUint32(salt));

    // Pack expire timestamp
    const expire = 0; // 0 means use privilege timestamps
    buffers.push(this.packUint32(expire));

    // Pack appId (CRITICAL: must be included in token content)
    buffers.push(this.packString(appId));

    // Pack services
    const services: Buffer[] = [];

    // Service type 1: RTC
    const rtcService = this.packRtcService(channelName, uid, privileges);
    services.push(rtcService);

    // Pack service count and services
    buffers.push(this.packUint16(services.length));
    services.forEach(s => buffers.push(s));

    return Buffer.concat(buffers);
  }

  private packRtcService(channelName: string, uid: string, privileges: Record<number, number>): Buffer {
    const buffers: Buffer[] = [];

    // Service type
    buffers.push(this.packUint16(1)); // RTC = 1

    // Pack privileges
    const privEntries = Object.entries(privileges);
    buffers.push(this.packUint16(privEntries.length));
    
    for (const [priv, expire] of privEntries) {
      buffers.push(this.packUint16(parseInt(priv)));
      buffers.push(this.packUint32(expire));
    }

    // Channel name
    buffers.push(this.packString(channelName));

    // UID
    buffers.push(this.packString(uid));

    return Buffer.concat(buffers);
  }

  private sign(certificate: string, content: Buffer): Buffer {
    const hmac = crypto.createHmac('sha256', certificate);
    hmac.update(content);
    return hmac.digest();
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
    const strBuf = Buffer.from(str, 'utf-8');
    const lenBuf = this.packUint16(strBuf.length);
    return Buffer.concat([lenBuf, strBuf]);
  }

  getAppId(): string {
    return this.appId;
  }
}

