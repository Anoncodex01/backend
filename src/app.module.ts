import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtModule } from '@nestjs/jwt';

// Core modules
import { RedisModule } from './core/redis/redis.module';
import { SupabaseModule } from './core/supabase/supabase.module';
import { FirebaseModule } from './core/firebase/firebase.module';

// Feature modules
import { AuthModule } from './modules/auth/auth.module';
import { FeedModule } from './modules/feed/feed.module';
import { LiveModule } from './modules/live/live.module';
import { ShopModule } from './modules/shop/shop.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { UsersModule } from './modules/users/users.module';
import { SearchModule } from './modules/search/search.module';
import { CommunitiesModule } from './modules/communities/communities.module';
import { CommentsModule } from './modules/comments/comments.module';

// Gateway
import { RealtimeGateway } from './gateways/realtime.gateway';

// Health
import { HealthController } from './health.controller';

@Module({
  imports: [
    // Config
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // Scheduling
    ScheduleModule.forRoot(),

    // JWT for WebSocket auth
    JwtModule.register({}),

    // Core
    RedisModule,
    SupabaseModule,
    FirebaseModule,

    // Features
    AuthModule,
    FeedModule,
    LiveModule,
    ShopModule,
    NotificationsModule,
    AnalyticsModule,
    UsersModule,
    SearchModule,
    CommunitiesModule,
    CommentsModule,
  ],
  controllers: [HealthController],
  providers: [RealtimeGateway],
})
export class AppModule {}

