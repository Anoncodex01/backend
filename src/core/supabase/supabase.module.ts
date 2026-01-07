import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from './supabase.service';

@Global()
@Module({
  providers: [
    {
      provide: 'SUPABASE_OPTIONS',
      useFactory: (configService: ConfigService) => ({
        url: configService.get('SUPABASE_URL'),
        serviceKey: configService.get('SUPABASE_SERVICE_KEY'),
        jwtSecret: configService.get('SUPABASE_JWT_SECRET'),
      }),
      inject: [ConfigService],
    },
    SupabaseService,
  ],
  exports: [SupabaseService],
})
export class SupabaseModule {}

