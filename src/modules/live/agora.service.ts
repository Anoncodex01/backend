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
   * Generate Agora RTC token using AccessToken2 format
   */
  generateRtcToken(
    channelName: string,
    uid: number | string,
    role: 'publisher' | 'subscriber' = 'subscriber',
    expirationSeconds: number = 3600,
  ): string {
    const version = '007';
    const ts = Math.floor(Date.now() / 1000);
    const salt = crypto.randomInt(0, 0xFFFFFFFF);
    const privilegeExpiredTs = ts + expirationSeconds;

    // Build privileges map
    const privileges = new Map<number, number>();
    privileges.set(Privileges.kJoinChannel, privilegeExpiredTs);

    if (role === 'publisher') {
      privileges.set(Privileges.kPublishAudioStream, privilegeExpiredTs);
      privileges.set(Privileges.kPublishVideoStream, privilegeExpiredTs);
      privileges.set(Privileges.kPublishDataStream, privilegeExpiredTs);
    }

    // Build message: salt + ts + privileges
    const messageParts: Buffer[] = [];
    messageParts.push(this.packUint32(salt));
    messageParts.push(this.packUint32(ts));
    messageParts.push(this.packPrivileges(privileges));

    const message = Buffer.concat(messageParts);

    // Generate signature: HMAC-SHA256(appCertificate, appId + channelName + uid + message)
    const uidStr = uid === 0 ? '' : uid.toString();
    const toSign = Buffer.concat([
      Buffer.from(this.appId, 'utf8'),
      Buffer.from(channelName, 'utf8'),
      Buffer.from(uidStr, 'utf8'),
      message,
    ]);

    const signature = crypto
      .createHmac('sha256', this.appCertificate)
      .update(toSign)
      .digest();

    // Build content: appId + signature_length + signature + message_length + message
    const contentParts: Buffer[] = [];
    contentParts.push(this.packString(this.appId));
    contentParts.push(this.packUint16(signature.length));
    contentParts.push(signature);
    contentParts.push(this.packUint16(message.length));
    contentParts.push(message);

    const content = Buffer.concat(contentParts);

    // Return: version + base64(content)
    return version + content.toString('base64');
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
    
    // Pack each privilege: key (uint16) + value (uint32) - in insertion order (like Supabase function)
    privileges.forEach((value, key) => {
      parts.push(this.packUint16(key));
      parts.push(this.packUint32(value));
    });
    
    return Buffer.concat(parts);
  }

  getAppId(): string {
    return this.appId;
  }
}
