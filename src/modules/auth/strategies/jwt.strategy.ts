import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy {
  constructor(private configService: ConfigService) {}

  getSecret(): string {
    return this.configService.get('SUPABASE_JWT_SECRET') || '';
  }
}

