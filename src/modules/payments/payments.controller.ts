import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards, Logger } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateMobilePaymentDto } from './dto/create-mobile-payment.dto';
import { CreateCardPaymentDto } from './dto/create-card-payment.dto';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { CreateGiftTransferDto } from './dto/create-gift-transfer.dto';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private paymentsService: PaymentsService) {}

  @UseGuards(AuthGuard)
  @Post('mobile')
  async createMobile(@CurrentUser() userId: string, @Body() dto: CreateMobilePaymentDto) {
    return this.paymentsService.createMobilePayment(userId, dto);
  }

  @UseGuards(AuthGuard)
  @Post('card')
  async createCard(@CurrentUser() userId: string, @Body() dto: CreateCardPaymentDto) {
    return this.paymentsService.createCardPayment(userId, dto);
  }

  @UseGuards(AuthGuard)
  @Get('wallet')
  async getWallet(@CurrentUser() userId: string) {
    return this.paymentsService.getWalletSummary(userId);
  }

  @UseGuards(AuthGuard)
  @Get(':reference/status')
  async getPaymentStatusFromDb(@CurrentUser() userId: string, @Param('reference') reference: string) {
    return this.paymentsService.getPaymentStatusFromDb(reference, userId);
  }

  @UseGuards(AuthGuard)
  @Post(':reference/check')
  async checkPaymentStatus(@CurrentUser() userId: string, @Param('reference') reference: string) {
    return this.paymentsService.manualCheckPaymentStatus(reference);
  }

  @Get(':reference')
  async getStatus(@Param('reference') reference: string) {
    return this.paymentsService.getPaymentStatus(reference);
  }

  @UseGuards(AuthGuard)
  @Post('withdraw')
  async withdraw(@CurrentUser() userId: string, @Body() dto: CreateWithdrawalDto) {
    return this.paymentsService.createWithdrawal(userId, dto);
  }

  @UseGuards(AuthGuard)
  @Post('gift')
  async gift(@CurrentUser() userId: string, @Body() dto: CreateGiftTransferDto) {
    return this.paymentsService.sendGift(userId, dto);
  }

  @Post('webhook')
  async webhook(@Req() req: any, @Headers() headers: Record<string, any>) {
    try {
      // Use rawBody if available, otherwise use parsed body
      const rawBody = req.rawBody ?? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
      this.logger.log('📥 Webhook endpoint called:', {
        method: req.method,
        url: req.url,
        event: headers['x-webhook-event'] || headers['X-Webhook-Event'],
        userAgent: headers['user-agent'] || headers['User-Agent'],
      });
      return await this.paymentsService.handleWebhook(rawBody, headers);
    } catch (error: any) {
      this.logger.error('❌ Webhook controller error:', {
        message: error.message,
        status: error.status,
        stack: error.stack,
      });
      throw error;
    }
  }
}
