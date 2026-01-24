import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateMobilePaymentDto } from './dto/create-mobile-payment.dto';
import { CreateCardPaymentDto } from './dto/create-card-payment.dto';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';

@Controller('payments')
export class PaymentsController {
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

  @Get(':reference')
  async getStatus(@Param('reference') reference: string) {
    return this.paymentsService.getPaymentStatus(reference);
  }

  @UseGuards(AuthGuard)
  @Post('withdraw')
  async withdraw(@CurrentUser() userId: string, @Body() dto: CreateWithdrawalDto) {
    return this.paymentsService.createWithdrawal(userId, dto);
  }

  @Post('webhook')
  async webhook(@Req() req: any, @Headers() headers: Record<string, any>) {
    const rawBody = req.rawBody ?? req.body;
    return this.paymentsService.handleWebhook(rawBody, headers);
  }
}
