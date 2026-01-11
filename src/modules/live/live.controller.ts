import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { IsString, IsBoolean, IsOptional } from 'class-validator';
import { LiveService } from './live.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

class StartLiveDto {
  @IsOptional()
  @IsString()
  title?: string;
}

class LiveTokenDto {
  @IsString()
  channelName: string;
  
  @IsBoolean()
  isHost: boolean;
}

@Controller('live')
export class LiveController {
  constructor(private liveService: LiveService) {}

  /**
   * GET /v1/live
   * Get all active live sessions
   */
  @Get()
  async getActiveSessions() {
    const sessions = await this.liveService.getActiveLiveSessions();

    return {
      success: true,
      data: sessions,
    };
  }

  /**
   * POST /v1/live/start
   * Start a new live session
   */
  @Post('start')
  @UseGuards(AuthGuard)
  async startLive(
    @CurrentUser() userId: string,
    @Body() dto: StartLiveDto,
  ) {
    const result = await this.liveService.startLiveSession({
      hostId: userId,
      title: dto.title,
    });

    return {
      success: true,
      data: result,
    };
  }

  /**
   * POST /v1/live/token
   * Generate Agora RTC token for a channel
   */
  @Post('token')
  @UseGuards(AuthGuard)
  async getToken(
    @CurrentUser() userId: string,
    @Body() dto: LiveTokenDto,
  ) {
    const result = await this.liveService.generateToken({
      channelName: dto.channelName,
      userId,
      isHost: dto.isHost,
    });

    return {
      success: true,
      data: result,
    };
  }

  /**
   * POST /v1/live/:id/join
   * Join a live session as viewer
   */
  @Post(':id/join')
  @UseGuards(AuthGuard)
  async joinLive(
    @Param('id') sessionId: string,
    @CurrentUser() userId: string,
  ) {
    const result = await this.liveService.joinLiveSession({
      sessionId,
      userId,
    });

    return {
      success: true,
      data: result,
    };
  }

  /**
   * POST /v1/live/:id/leave
   * Leave a live session
   */
  @Post(':id/leave')
  @UseGuards(AuthGuard)
  async leaveLive(
    @Param('id') sessionId: string,
    @CurrentUser() userId: string,
  ) {
    const result = await this.liveService.leaveLiveSession(sessionId, userId);

    return {
      success: true,
      data: result,
    };
  }

  /**
   * POST /v1/live/:id/end
   * End a live session (host only)
   */
  @Post(':id/end')
  @UseGuards(AuthGuard)
  async endLive(
    @Param('id') sessionId: string,
    @CurrentUser() userId: string,
  ) {
    const result = await this.liveService.endLiveSession(sessionId, userId);

    return {
      success: true,
      data: result,
    };
  }

  /**
   * GET /v1/live/:id/state
   * Get current live session state (viewers, hearts)
   */
  @Get(':id/state')
  async getLiveState(@Param('id') sessionId: string) {
    const state = await this.liveService.getLiveState(sessionId);

    return {
      success: true,
      data: state,
    };
  }

  /**
   * POST /v1/live/:id/heart
   * Send a heart (with rate limiting)
   */
  @Post(':id/heart')
  @UseGuards(AuthGuard)
  async sendHeart(
    @Param('id') sessionId: string,
    @CurrentUser() userId: string,
  ) {
    const result = await this.liveService.sendHeart(sessionId, userId);

    return {
      success: true,
      data: result,
    };
  }
}

