import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateZegoToken04 } from './zego-token';

@Injectable()
export class ZegoService {
  private readonly logger = new Logger(ZegoService.name);
  private readonly appId: number;
  private readonly serverSecret: string;
  private readonly appSign: string;

  constructor(private configService: ConfigService) {
    this.appId = parseInt(
      this.configService.get<string>('ZEGO_APP_ID', '1495665265'),
      10,
    );
    this.serverSecret = this.configService.get<string>(
      'ZEGO_SERVER_SECRET',
      '',
    );
    this.appSign = (this.configService.get<string>('ZEGO_APP_SIGN', '') ?? '')
      .trim();

    if (!Number.isFinite(this.appId) || this.appId <= 0) {
      this.logger.error('ZEGO_APP_ID is missing or invalid');
    }
    if (!this.serverSecret || this.serverSecret.length !== 32) {
      this.logger.error(
        'ZEGO_SERVER_SECRET must be the 32-character ServerSecret from the ZEGO console',
      );
    } else {
      this.logger.log('ZEGO token service configured');
    }
  }

  getAppId(): number {
    return this.appId;
  }

  /** 64-char AppSign from console. Used by ZegoEffects on the client. */
  getAppSign(): string {
    return this.appSign;
  }

  generateToken(params: {
    userId: string;
    liveId: string;
    canPublish: boolean;
    expireSeconds?: number;
  }): { token: string; expireSeconds: number; appId: number } {
    if (!this.serverSecret || this.serverSecret.length !== 32) {
      throw new Error('ZEGO_SERVER_SECRET is not configured');
    }

    const expireSeconds = params.expireSeconds ?? 3600;
    const payload = JSON.stringify({
      room_id: params.liveId,
      privilege: {
        1: 1, // login room
        2: 1, // publish (host + co-host)
      },
      stream_id_list: null,
    });

    const token = generateZegoToken04(
      this.appId,
      params.userId,
      this.serverSecret,
      expireSeconds,
      payload,
    );

    return {
      token,
      expireSeconds,
      appId: this.appId,
    };
  }
}
