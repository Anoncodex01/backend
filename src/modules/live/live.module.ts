import { Module } from '@nestjs/common';
import { LiveController } from './live.controller';
import { LiveService } from './live.service';
import { AgoraService } from './agora.service';
import { ZegoService } from './zego.service';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [LiveController],
  providers: [LiveService, AgoraService, ZegoService],
  exports: [LiveService, AgoraService, ZegoService],
})
export class LiveModule {}
