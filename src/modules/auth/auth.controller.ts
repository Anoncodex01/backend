import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { IsString } from 'class-validator';
import { AuthService } from './auth.service';
import { AuthGuard } from './guards/auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

class FirebaseTokenDto {
  // Supabase JWT is passed in Authorization header
}

class FcmTokenDto {
  @IsString()
  fcmToken: string;
  @IsString()
  deviceId: string;
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * POST /v1/auth/firebase-token
   * 
   * This is the CRITICAL endpoint that fixes Firestore permission-denied errors.
   * 
   * How it works:
   * 1. Flutter app authenticates with Supabase (gets Supabase JWT)
   * 2. Flutter calls this endpoint with the Supabase JWT
   * 3. VPS verifies the Supabase JWT
   * 4. VPS creates a Firebase Custom Token for the same user ID
   * 5. Flutter signs into Firebase Auth with this custom token
   * 6. Now Firestore rules work because request.auth.uid is set
   */
  @Post('firebase-token')
  async getFirebaseToken(@Headers('authorization') authHeader: string) {
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing authorization header');
    }

    const supabaseToken = authHeader.replace('Bearer ', '');
    
    // Verify Supabase token
    const payload = await this.authService.verifySupabaseToken(supabaseToken);
    
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }

    // Get Firebase custom token
    const result = await this.authService.getFirebaseToken(payload.sub);

    return {
      success: true,
      data: {
        firebaseToken: result.token,
        expiresIn: result.expiresIn,
        userId: payload.sub,
      },
    };
  }

  /**
   * GET /v1/auth/me
   * Get current user profile
   */
  @Get('me')
  @UseGuards(AuthGuard)
  async getMe(@CurrentUser() userId: string) {
    const user = await this.authService.getUserProfile(userId);

    return {
      success: true,
      data: user,
    };
  }

  /**
   * POST /v1/auth/fcm-token
   * Store FCM token for push notifications
   */
  @Post('fcm-token')
  @UseGuards(AuthGuard)
  async storeFcmToken(
    @CurrentUser() userId: string,
    @Body() dto: FcmTokenDto,
  ) {
    await this.authService.storeFcmToken(userId, dto.fcmToken, dto.deviceId);

    return {
      success: true,
      message: 'FCM token stored',
    };
  }

  /**
   * POST /v1/auth/logout
   * Remove FCM token on logout
   */
  @Post('logout')
  @UseGuards(AuthGuard)
  async logout(
    @CurrentUser() userId: string,
    @Body() dto: { deviceId: string },
  ) {
    await this.authService.removeFcmToken(userId, dto.deviceId);
    await this.authService.invalidateUserCache(userId);

    return {
      success: true,
      message: 'Logged out',
    };
  }
}

