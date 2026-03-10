import {
  Injectable,
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { v4 as uuidv4 } from 'uuid';
import * as nodemailer from 'nodemailer';
import { timingSafeEqual } from 'crypto';
import { RedisService } from '../../core/redis/redis.service';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { FirebaseService } from '../../core/firebase/firebase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateMobilePaymentDto } from './dto/create-mobile-payment.dto';
import { CreateCardPaymentDto } from './dto/create-card-payment.dto';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { CreateGiftTransferDto } from './dto/create-gift-transfer.dto';
import { CreateVerificationSubscriptionDto } from './dto/create-verification-subscription.dto';
import { SubmitKycDto } from './dto/submit-kyc.dto';

type SnippeResponse = {
  status: string;
  code: number;
  data: {
    reference: string;
    status: string;
    amount: number;
    currency: string;
    payment_type: string;
    payment_url?: string;
    expires_at?: string;
  };
};

type VerificationPlan = {
  code: 'monthly' | '6months' | 'yearly';
  name: string;
  price_tzs: number;
  duration_months: number;
  sort_order: number;
};

type GiftCatalogItem = {
  id: string;
  name: string;
  icon: string;
  coinCost: number;
  accentHex: string;
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly defaultVerificationPlans: VerificationPlan[] = [
    { code: 'monthly', name: 'Verified Badge Monthly', price_tzs: 4500, duration_months: 1, sort_order: 1 },
    { code: '6months', name: 'Verified Badge 6 Months', price_tzs: 22500, duration_months: 6, sort_order: 2 },
    { code: 'yearly', name: 'Verified Badge Yearly', price_tzs: 40500, duration_months: 12, sort_order: 3 },
  ];
  private readonly giftCatalog: GiftCatalogItem[] = [
    { id: 'rose', name: 'Rose', icon: '🌹', coinCost: 10, accentHex: '#FF5F6D' },
    { id: 'star', name: 'Star', icon: '⭐', coinCost: 20, accentHex: '#FFC107' },
    { id: 'spark', name: 'Spark', icon: '✨', coinCost: 25, accentHex: '#7C4DFF' },
    { id: 'fire', name: 'Fire', icon: '🔥', coinCost: 40, accentHex: '#FF6D00' },
    { id: 'heart', name: 'Heart', icon: '💖', coinCost: 50, accentHex: '#FF4081' },
    { id: 'confetti', name: 'Confetti', icon: '🎉', coinCost: 60, accentHex: '#AB47BC' },
    { id: 'butterfly', name: 'Butterfly', icon: '🦋', coinCost: 80, accentHex: '#26C6DA' },
    { id: 'music_note', name: 'Music Note', icon: '🎵', coinCost: 90, accentHex: '#5C6BC0' },
    { id: 'rainbow', name: 'Rainbow', icon: '🌈', coinCost: 110, accentHex: '#42A5F5' },
    { id: 'lightning', name: 'Lightning', icon: '⚡', coinCost: 120, accentHex: '#FFEB3B' },
    { id: 'cupcake', name: 'Cupcake', icon: '🧁', coinCost: 140, accentHex: '#F06292' },
    { id: 'crown', name: 'Crown', icon: '👑', coinCost: 150, accentHex: '#FFD54F' },
    { id: 'trophy', name: 'Trophy', icon: '🏆', coinCost: 180, accentHex: '#FFD54F' },
    { id: 'sun', name: 'Sun', icon: '☀️', coinCost: 200, accentHex: '#FFB300' },
    { id: 'snowflake', name: 'Snowflake', icon: '❄️', coinCost: 220, accentHex: '#4FC3F7' },
    { id: 'flower', name: 'Flower', icon: '🌸', coinCost: 240, accentHex: '#F48FB1' },
    { id: 'party_popper', name: 'Party Popper', icon: '🎊', coinCost: 260, accentHex: '#BA68C8' },
    { id: 'shamrock', name: 'Shamrock', icon: '🍀', coinCost: 280, accentHex: '#66BB6A' },
    { id: 'diamond', name: 'Diamond', icon: '💎', coinCost: 300, accentHex: '#40C4FF' },
    { id: 'planet', name: 'Planet', icon: '🪐', coinCost: 320, accentHex: '#7986CB' },
    { id: 'guitar', name: 'Guitar', icon: '🎸', coinCost: 360, accentHex: '#8D6E63' },
    { id: 'camera', name: 'Camera', icon: '📸', coinCost: 400, accentHex: '#26A69A' },
    { id: 'boxing_gloves', name: 'Boxing Gloves', icon: '🥊', coinCost: 450, accentHex: '#EF5350' },
    { id: 'magic_wand', name: 'Magic Wand', icon: '🪄', coinCost: 500, accentHex: '#7E57C2' },
    { id: 'rocket', name: 'Rocket', icon: '🚀', coinCost: 600, accentHex: '#00E676' },
    { id: 'golden_star', name: 'Golden Star', icon: '🌟', coinCost: 700, accentHex: '#FFD54F' },
    { id: 'castle', name: 'Castle', icon: '🏰', coinCost: 900, accentHex: '#B39DDB' },
    { id: 'supercar', name: 'Supercar', icon: '🏎️', coinCost: 1200, accentHex: '#E53935' },
    { id: 'yacht', name: 'Yacht', icon: '🛥️', coinCost: 1800, accentHex: '#26C6DA' },
  ];

  constructor(
    private config: ConfigService,
    private supabase: SupabaseService,
    private redis: RedisService,
    private firebase: FirebaseService,
    private notifications: NotificationsService,
  ) {}

  private get apiUrl() {
    return this.config.get<string>('SNIPPE_API_URL', 'https://api.snippe.sh/api/v1');
  }

  private get apiKey() {
    return this.config.get<string>('SNIPPE_API_KEY', '');
  }

  private get webhookUrl() {
    return this.config.get<string>('SNIPPE_WEBHOOK_URL', '');
  }

  private get payoutWebhookUrl() {
    return this.config.get<string>('SNIPPE_PAYOUT_WEBHOOK_URL', this.webhookUrl);
  }

  private get coinRate() {
    return Number(this.config.get<string>('COIN_RATE', '1'));
  }

  private normalizeGiftKey(value?: string | null) {
    return (value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private resolveGiftCatalogItem(dto: CreateGiftTransferDto) {
    const candidateKeys = [
      this.normalizeGiftKey(dto.giftId),
      this.normalizeGiftKey(dto.giftName),
    ].filter(Boolean);

    return this.giftCatalog.find((gift) => candidateKeys.includes(gift.id));
  }

  getGiftCatalog() {
    return {
      items: this.giftCatalog.map((gift) => ({
        ...gift,
        isPremium: gift.coinCost >= 600,
      })),
    };
  }

  private async logAdminEvent(params: {
    level?: 'info' | 'warn' | 'error';
    category: string;
    message: string;
    metadata?: Record<string, any>;
  }) {
    try {
      const client = this.supabase.getClient();
      await client.from('admin_logs').insert({
        level: params.level || 'info',
        category: params.category,
        message: params.message,
        metadata: params.metadata || {},
      });
    } catch {
      // Avoid breaking payment flows if logging fails
    }
  }

  private get smtpHost() {
    return this.config.get<string>('SMTP_HOST', '');
  }

  private get smtpPort() {
    return Number(this.config.get<string>('SMTP_PORT', '587'));
  }

  private get smtpUser() {
    return this.config.get<string>('SMTP_USER', '');
  }

  private get smtpPass() {
    return this.config.get<string>('SMTP_PASS', '');
  }

  private get smtpFrom() {
    return this.config.get<string>('SMTP_FROM', 'WhapVibez <no-reply@whapvibez.com>');
  }

  async createMobilePayment(userId: string, dto: CreateMobilePaymentDto) {
    if (!this.apiKey) {
      throw new BadRequestException('Payment provider not configured');
    }

    const idempotencyKey = uuidv4();
    const metadata = {
      user_id: userId,
      kind: dto.kind || 'coin_topup',
      order_id: dto.orderId,
      product: dto.product,
      ...(dto.metadata || {}),
    };

    const payload = {
      payment_type: 'mobile',
      details: {
        amount: dto.amount,
        currency: dto.currency,
        callback_url: dto.callbackUrl,
      },
      phone_number: dto.phoneNumber,
      customer: {
        firstname: dto.customerFirstName,
        lastname: dto.customerLastName,
        email: dto.customerEmail,
      },
      webhook_url: this.webhookUrl || undefined,
      metadata,
    };

    const response = await this.postToSnippe(payload, idempotencyKey);
    await this.logAdminEvent({
      category: 'payment',
      message: `Payment intent created (mobile) ${response.data.reference}`,
      metadata: { userId, amount: dto.amount, currency: dto.currency, kind: dto.kind, orderId: dto.orderId },
    });
    
    // Extract amount - handle both number and object formats
    const amountValue: any = response.data.amount;
    const amount = typeof amountValue === 'object' && amountValue !== null && 'value' in amountValue
      ? amountValue.value
      : typeof amountValue === 'number'
      ? amountValue
      : Number(amountValue) || 0;
    
    // Extract currency - handle both string and object formats
    const currencyValue: any = response.data.amount;
    const currency = typeof currencyValue === 'object' && currencyValue !== null && 'currency' in currencyValue
      ? currencyValue.currency
      : response.data.currency || 'TZS';
    
    try {
      await this.storeIntent({
        userId,
        reference: response.data.reference,
        status: response.data.status,
        amount,
        currency,
        paymentType: response.data.payment_type,
        paymentUrl: response.data.payment_url,
        expiresAt: response.data.expires_at,
        idempotencyKey,
        phoneNumber: dto.phoneNumber,
        metadata,
      });
      this.logger.log(`✅ Payment intent stored for reference: ${response.data.reference}`);
    } catch (error: any) {
      this.logger.error(`❌ Failed to store payment intent for reference: ${response.data.reference}`, {
        error: error.message,
        stack: error.stack,
      });
      // Don't throw - payment was created, just log the error
    }

    // Check payment status immediately after creation (with small delay for processing)
    setTimeout(async () => {
      try {
        await this.checkAndUpdatePaymentStatus(response.data.reference);
      } catch (error) {
        // Silent fail - cron job will handle it
        this.logger.debug(`Immediate check failed for ${response.data.reference}, will retry via cron`);
      }
    }, 3000); // Check after 3 seconds

    return response;
  }

  private addMonths(date: Date, months: number): Date {
    const next = new Date(date);
    next.setMonth(next.getMonth() + months);
    return next;
  }

  private async getVerificationPlanMap(): Promise<Map<string, VerificationPlan>> {
    const client = this.supabase.getClient();
    try {
      const { data } = await client
        .from('verification_plans')
        .select('code, name, price_tzs, duration_months, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      const rows = (data || []) as any[];
      if (!rows.length) {
        return new Map(this.defaultVerificationPlans.map((p) => [p.code, p]));
      }

      const plans: VerificationPlan[] = rows.map((r) => ({
        code: r.code,
        name: r.name,
        price_tzs: Number(r.price_tzs || 0),
        duration_months: Number(r.duration_months || 0),
        sort_order: Number(r.sort_order || 0),
      }));
      return new Map(plans.map((p) => [p.code, p]));
    } catch (e) {
      this.logger.warn(`verification_plans read failed, using defaults: ${(e as any)?.message || e}`);
      return new Map(this.defaultVerificationPlans.map((p) => [p.code, p]));
    }
  }

  async getVerificationPlans() {
    const plansMap = await this.getVerificationPlanMap();
    const plans = Array.from(plansMap.values()).sort((a, b) => a.sort_order - b.sort_order);
    return {
      success: true,
      data: plans,
    };
  }

  async getVerificationStatus(userId: string) {
    const client = this.supabase.getClient();
    const nowIso = new Date().toISOString();

    await client
      .from('user_verification_subscriptions')
      .update({ status: 'expired', updated_at: nowIso })
      .eq('user_id', userId)
      .eq('status', 'active')
      .lte('ends_at', nowIso);

    const { data: activeSub } = await client
      .from('user_verification_subscriptions')
      .select('id, plan_code, amount_tzs, started_at, ends_at, status, payment_reference')
      .eq('user_id', userId)
      .eq('status', 'active')
      .gt('ends_at', nowIso)
      .order('ends_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let kycStatus: 'not_submitted' | 'pending' | 'approved' | 'rejected' = 'not_submitted';
    if (activeSub) {
      const { data: latestKyc } = await client
        .from('user_kyc_submissions')
        .select('status')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestKyc?.status === 'approved') kycStatus = 'approved';
      else if (latestKyc?.status === 'rejected') kycStatus = 'rejected';
      else if (latestKyc?.status === 'pending') kycStatus = 'pending';
    }
    const kycRequired = !!activeSub && kycStatus !== 'approved';
    const isVerified = !!activeSub && kycStatus === 'approved';
    try {
      await client.from('users').update({ is_verified: isVerified }).eq('id', userId);
      await this.invalidateUserVerificationCaches(userId);
    } catch {
      // Don't fail status endpoint if profile sync fails
    }

    let remainingDays = 0;
    if (activeSub?.ends_at) {
      const end = new Date(activeSub.ends_at);
      const diff = end.getTime() - Date.now();
      remainingDays = diff > 0 ? Math.ceil(diff / (1000 * 60 * 60 * 24)) : 0;
    }

    return {
      success: true,
      data: {
        is_verified: isVerified,
        subscription: activeSub || null,
        remaining_days: remainingDays,
        kyc_status: kycStatus,
        kyc_required: kycRequired,
      },
    };
  }

  async submitKyc(userId: string, dto: SubmitKycDto) {
    const client = this.supabase.getClient();
    const { data: activeSub, error: activeSubError } = await client
      .from('user_verification_subscriptions')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .gt('ends_at', new Date().toISOString())
      .order('ends_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeSubError) {
      this.logger.error(`submitKyc active subscription lookup failed: ${activeSubError.message}`);
      throw new BadRequestException('Failed to validate verification subscription.');
    }
    if (!activeSub) {
      throw new BadRequestException('No active verification subscription. Please subscribe first.');
    }
    const { data: existing, error: existingError } = await client
      .from('user_kyc_submissions')
      .select('id, status')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) {
      this.logger.error(`submitKyc existing submission lookup failed: ${existingError.message}`);
      throw new BadRequestException('Failed to validate previous KYC submissions.');
    }
    if (existing?.status === 'pending') {
      throw new BadRequestException('KYC already submitted and awaiting review (up to 1 business day).');
    }
    if (existing?.status === 'approved') {
      throw new BadRequestException('KYC already approved.');
    }
    const idBack = dto.idDocumentType === 'passport' ? null : dto.idBackUrl;
    if (dto.idDocumentType !== 'passport' && !idBack) {
      throw new BadRequestException('ID back photo is required for ID Card and Driving Licence.');
    }
    this.assertKycUrlBelongsToUser(dto.idFrontUrl, userId, 'idFrontUrl');
    this.assertKycUrlBelongsToUser(dto.selfieUrl, userId, 'selfieUrl');
    if (idBack) {
      this.assertKycUrlBelongsToUser(idBack, userId, 'idBackUrl');
    }
    const { error: insertError } = await client.from('user_kyc_submissions').insert({
      user_id: userId,
      subscription_id: activeSub.id,
      id_document_type: dto.idDocumentType,
      id_front_url: dto.idFrontUrl,
      id_back_url: idBack,
      selfie_url: dto.selfieUrl,
      status: 'pending',
    });
    if (insertError) {
      this.logger.error(`submitKyc insert failed for user ${userId}: ${insertError.message}`);
      throw new BadRequestException('Failed to submit KYC. Please try again.');
    }
    return {
      success: true,
      data: {
        message: 'KYC submitted. We will review within 1 business day and email you when approved.',
      },
    };
  }

  async getKycStatus(userId: string) {
    const client = this.supabase.getClient();
    const { data: latest } = await client
      .from('user_kyc_submissions')
      .select('id, status, rejection_reason, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return {
      success: true,
      data: latest ? { status: latest.status, rejection_reason: latest.rejection_reason, submitted_at: latest.created_at } : null,
    };
  }

  async approveKycSubmission(kycId: string, adminSecret: string) {
    this.assertAdminSecret(adminSecret);
    const client = this.supabase.getClient();
    const { data: kyc } = await client
      .from('user_kyc_submissions')
      .select('id, user_id, status')
      .eq('id', kycId)
      .maybeSingle();
    if (!kyc) throw new BadRequestException('KYC submission not found');
    if (kyc.status !== 'pending') throw new BadRequestException(`KYC already ${kyc.status}`);
    await client
      .from('user_kyc_submissions')
      .update({ status: 'approved', reviewed_at: new Date().toISOString() })
      .eq('id', kycId);
    await this.syncUserVerificationFlag(kyc.user_id);
    await this.sendVerificationApprovalEmail(kyc.user_id);
    return { success: true, data: { message: 'KYC approved. User verified. Email sent.' } };
  }

  async rejectKycSubmission(kycId: string, reason: string, adminSecret: string) {
    this.assertAdminSecret(adminSecret);
    const client = this.supabase.getClient();
    const { data: kyc } = await client
      .from('user_kyc_submissions')
      .select('id, status, user_id')
      .eq('id', kycId)
      .maybeSingle();
    if (!kyc) throw new BadRequestException('KYC submission not found');
    if (kyc.status !== 'pending') throw new BadRequestException(`KYC already ${kyc.status}`);
    await client
      .from('user_kyc_submissions')
      .update({ status: 'rejected', rejection_reason: reason || 'Rejected', reviewed_at: new Date().toISOString() })
      .eq('id', kycId);
    if (kyc.user_id) {
      await this.syncUserVerificationFlag(kyc.user_id);
    }
    return { success: true, data: { message: 'KYC rejected.' } };
  }

  private async sendVerificationApprovalEmail(userId: string) {
    if (!this.smtpHost || !this.smtpUser || !this.smtpPass) {
      this.logger.debug('SMTP not configured, skipping verification approval email.');
      return;
    }
    const client = this.supabase.getClient();
    const { data: user } = await client
      .from('users')
      .select('email, full_name, username')
      .eq('id', userId)
      .maybeSingle();
    if (!user?.email) {
      this.logger.warn(`User email not found for verification approval: ${userId}`);
      return;
    }
    const name = user.full_name || user.username || 'Creator';
    const transporter = nodemailer.createTransport({
      host: this.smtpHost,
      port: this.smtpPort,
      secure: this.smtpPort === 465,
      auth: { user: this.smtpUser, pass: this.smtpPass },
    });
    const subject = 'Verified Badge activated – WhapVibez';
    const text = [
      `Hi ${name},`,
      '',
      'Congratulations! Your identity verification has been approved.',
      'Your Verified Badge is now active on your profile.',
      '',
      'Thanks for being part of WhapVibez!',
      '',
      '— WhapVibez',
    ].join('\n');
    try {
      await transporter.sendMail({ from: this.smtpFrom, to: user.email, subject, text });
      this.logger.log(`📧 Verification approval email sent to ${user.email}`);
    } catch (e: any) {
      this.logger.error(`❌ Failed to send verification approval email: ${e.message}`);
    }
  }

  async subscribeVerification(userId: string, dto: CreateVerificationSubscriptionDto) {
    try {
      const client = this.supabase.getClient();
      const planCode = (dto.planCode || '').toLowerCase() as CreateVerificationSubscriptionDto['planCode'];
      const plansMap = await this.getVerificationPlanMap();
      const plan = plansMap.get(planCode);
      if (!plan) {
        throw new BadRequestException('Invalid verification plan');
      }
      if (plan.price_tzs <= 0 || plan.duration_months <= 0) {
        throw new BadRequestException('Verification plan misconfigured');
      }
      if (!this.apiKey) {
        throw new BadRequestException('Payment provider not configured');
      }

      const paymentType = (dto.paymentType || '').toLowerCase();
      if (paymentType !== 'mobile' && paymentType !== 'card') {
        throw new BadRequestException('Invalid payment type');
      }

      const { data: user } = await client
        .from('users')
        .select('full_name, username, email')
        .eq('id', userId)
        .maybeSingle();

      const fullName = (user?.full_name || user?.username || 'Whapvibez User').toString().trim();
      const nameParts = fullName.split(/\s+/).filter(Boolean);
      const firstName = dto.customerFirstName || nameParts[0] || 'Whapvibez';
      const lastName = dto.customerLastName || nameParts.slice(1).join(' ') || 'User';
      const customerEmail = dto.customerEmail || user?.email || 'support@whapvibez.com';

      const idempotencyKey = uuidv4();
      const metadata = {
        user_id: userId,
        kind: 'verification_subscription',
        plan_code: plan.code,
        plan_name: plan.name,
        plan_price_tzs: plan.price_tzs,
        duration_months: plan.duration_months,
        product: 'verified_badge',
      };

      let response: SnippeResponse;
      if (paymentType === 'mobile') {
        if (!dto.phoneNumber) {
          throw new BadRequestException('Phone number is required for mobile payment');
        }
        const payload = {
          payment_type: 'mobile',
          details: {
            amount: plan.price_tzs,
            currency: 'TZS',
            callback_url: dto.callbackUrl,
          },
          phone_number: dto.phoneNumber,
          customer: {
            firstname: firstName,
            lastname: lastName,
            email: customerEmail,
          },
          webhook_url: this.webhookUrl || undefined,
          metadata,
        };
        response = await this.postToSnippe(payload, idempotencyKey);
      } else {
        if (!dto.redirectUrl) {
          throw new BadRequestException('redirectUrl is required for card payment');
        }
        const cancelUrl = dto.cancelUrl || dto.redirectUrl.replace(/\/[^/]*$/, '/cancelled');
        const payload = {
          payment_type: 'card',
          details: {
            amount: plan.price_tzs,
            currency: 'TZS',
            redirect_url: dto.redirectUrl,
            cancel_url: cancelUrl,
          },
          customer: {
            firstname: firstName,
            lastname: lastName,
            email: customerEmail,
          },
          webhook_url: this.webhookUrl || undefined,
          metadata,
        };
        response = await this.postToSnippe(payload, idempotencyKey);
      }

      if (!response?.data) {
        throw new BadRequestException('Invalid response from payment provider');
      }
      const amountValue: any = response.data.amount;
      const amount = typeof amountValue === 'object' && amountValue !== null && 'value' in amountValue
        ? amountValue.value
        : typeof amountValue === 'number'
        ? amountValue
        : Number(amountValue) || plan.price_tzs;
      const currencyValue: any = response.data.amount;
      const currency = typeof currencyValue === 'object' && currencyValue !== null && 'currency' in currencyValue
        ? currencyValue.currency
        : response.data.currency || 'TZS';

      try {
        await this.storeIntent({
          userId,
          reference: response.data.reference,
          status: response.data.status,
          amount,
          currency,
          paymentType: response.data.payment_type,
          paymentUrl: response.data.payment_url,
          expiresAt: response.data.expires_at,
          idempotencyKey,
          phoneNumber: dto.phoneNumber,
          metadata,
        });
      } catch (storeErr: any) {
        // Keep flow non-fatal like other payment endpoints.
        this.logger.warn(
          `Verification payment intent store failed for ${response.data.reference}: ${storeErr?.message || storeErr}`,
        );
      }

      // Fallback for providers/environments where webhook delivery is delayed.
      setTimeout(async () => {
        try {
          await this.checkAndUpdatePaymentStatus(response.data.reference);
        } catch (e: any) {
          this.logger.debug(
            `Verification immediate status check failed for ${response.data.reference}: ${e?.message || e}`,
          );
        }
      }, 3000);

      return {
        success: true,
        data: {
          plan_code: plan.code,
          amount_tzs: plan.price_tzs,
          payment_type: paymentType,
          reference: response.data.reference,
          status: response.data.status,
          payment_url: response.data.payment_url,
          expires_at: response.data.expires_at,
        },
      };
    } catch (e: any) {
      if (e instanceof BadRequestException) throw e;
      this.logger.error(`subscribeVerification failed for user ${userId}: ${e?.message || e}`);
      throw new BadRequestException('Unable to start verification payment');
    }
  }

  async retryVerificationMobilePayment(userId: string, reference: string) {
    const client = this.supabase.getClient();
    const { data: intent, error } = await client
      .from('payment_intents')
      .select(
        'reference, status, amount, currency, payment_type, phone_number, metadata, user_id',
      )
      .eq('reference', reference)
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !intent) {
      throw new BadRequestException('Payment not found');
    }
    if (intent.payment_type !== 'mobile') {
      throw new BadRequestException('Retry is available for mobile payments only');
    }
    if (intent.status === 'completed') {
      throw new BadRequestException('Payment already completed');
    }

    const metadata = (intent.metadata || {}) as Record<string, any>;
    if (metadata.kind !== 'verification_subscription') {
      throw new BadRequestException('Invalid payment type for retry');
    }

    const retryCount = Number(metadata.retry_count || 0);
    if (retryCount >= 2) {
      throw new BadRequestException('Maximum retry attempts reached');
    }

    const phoneNumber = (intent.phone_number || '').toString().trim();
    if (!phoneNumber) {
      throw new BadRequestException('Phone number missing on payment');
    }

    if (!this.apiKey) {
      throw new BadRequestException('Payment provider not configured');
    }

    const { data: user } = await client
      .from('users')
      .select('full_name, username, email')
      .eq('id', userId)
      .maybeSingle();

    const fullName = (user?.full_name || user?.username || 'Whapvibez User').toString().trim();
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || 'Whapvibez';
    const lastName = nameParts.slice(1).join(' ') || 'User';
    const customerEmail = user?.email || 'support@whapvibez.com';

    const nextMetadata = {
      ...metadata,
      retry_of: metadata.retry_of || reference,
      retry_count: retryCount + 1,
    };

    const idempotencyKey = uuidv4();
    const payload = {
      payment_type: 'mobile',
      details: {
        amount: Number(metadata.plan_price_tzs || intent.amount || 0),
        currency: intent.currency || 'TZS',
      },
      phone_number: phoneNumber,
      customer: {
        firstname: firstName,
        lastname: lastName,
        email: customerEmail,
      },
      webhook_url: this.webhookUrl || undefined,
      metadata: nextMetadata,
    };

    const response = await this.postToSnippe(payload, idempotencyKey);
    if (!response?.data?.reference) {
      throw new BadRequestException('Invalid response from payment provider');
    }

    const amountValue: any = response.data.amount;
    const amount =
      typeof amountValue === 'object' && amountValue !== null && 'value' in amountValue
        ? amountValue.value
        : typeof amountValue === 'number'
          ? amountValue
          : Number(amountValue) || Number(intent.amount || 0);

    await this.storeIntent({
      userId,
      reference: response.data.reference,
      status: response.data.status || 'pending',
      amount,
      currency: response.data.currency || intent.currency || 'TZS',
      paymentType: 'mobile',
      paymentUrl: response.data.payment_url,
      expiresAt: response.data.expires_at,
      idempotencyKey,
      phoneNumber,
      metadata: nextMetadata,
    });

    await client
      .from('payment_intents')
      .update({
        metadata: {
          ...metadata,
          retried_to: response.data.reference,
          retry_count: retryCount + 1,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('reference', reference)
      .eq('user_id', userId);

    return {
      success: true,
      data: {
        reference: response.data.reference,
        status: response.data.status || 'pending',
        payment_type: 'mobile',
        payment_url: response.data.payment_url,
        expires_at: response.data.expires_at,
        retry_count: retryCount + 1,
      },
    };
  }

  private async activateVerificationSubscriptionFromPayment(input: {
    userId: string;
    reference: string;
    amountTzs: number;
    metadata: Record<string, any>;
  }) {
    const client = this.supabase.getClient();
    const now = new Date();
    const nowIso = now.toISOString();
    const planCode = (input.metadata?.plan_code || 'monthly').toString();
    const durationMonths = Number(input.metadata?.duration_months || 1);
    const amountTzs = Number(input.metadata?.plan_price_tzs || input.amountTzs || 0);

    const { data: existing } = await client
      .from('user_verification_subscriptions')
      .select('id')
      .eq('payment_reference', input.reference)
      .maybeSingle();
    if (existing?.id) {
      return;
    }

    const { data: currentActive } = await client
      .from('user_verification_subscriptions')
      .select('id, ends_at')
      .eq('user_id', input.userId)
      .eq('status', 'active')
      .gt('ends_at', nowIso)
      .order('ends_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const startAt = currentActive?.ends_at ? new Date(currentActive.ends_at) : now;
    const endAt = this.addMonths(startAt, durationMonths);

    // Safety cleanup: keep only the latest active subscription and expire older duplicate active rows.
    if (currentActive?.id) {
      await client
        .from('user_verification_subscriptions')
        .update({ status: 'expired', updated_at: nowIso })
        .eq('user_id', input.userId)
        .eq('status', 'active')
        .neq('id', currentActive.id)
        .gt('ends_at', nowIso);
    }

    await client
      .from('user_verification_subscriptions')
      .insert({
        user_id: input.userId,
        plan_code: planCode,
        amount_tzs: amountTzs,
        status: 'active',
        started_at: startAt.toISOString(),
        ends_at: endAt.toISOString(),
        payment_reference: input.reference,
        metadata: {
          source: 'direct_payment',
          duration_months: durationMonths,
          extended_from_subscription_id: currentActive?.id || null,
        },
      });
    await this.syncUserVerificationFlag(input.userId);
  }

  private assertAdminSecret(adminSecret: string) {
    const secret = (this.config.get<string>('ADMIN_SECRET') || '').trim();
    if (!secret || secret.length < 16) {
      throw new BadRequestException('Admin review endpoint is not configured');
    }
    const provided = (adminSecret || '').trim();
    if (!provided) {
      throw new UnauthorizedException('Unauthorized');
    }
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Unauthorized');
    }
  }

  private assertKycUrlBelongsToUser(url: string, userId: string, field: string) {
    if (!url || !userId) {
      throw new BadRequestException(`${field} is required`);
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException(`${field} is invalid`);
    }
    const markers = [
      `/storage/v1/object/public/verification-kyc/${userId}/`,
      `/storage/v1/object/sign/verification-kyc/${userId}/`,
      `/storage/v1/object/authenticated/verification-kyc/${userId}/`,
    ];
    const matches = markers.some((marker) => parsed.pathname.includes(marker));
    if (!matches) {
      throw new BadRequestException(`${field} does not belong to the current user`);
    }
  }

  private async syncUserVerificationFlag(userId: string) {
    const client = this.supabase.getClient();
    const nowIso = new Date().toISOString();
    const [{ data: activeSub }, { data: latestKyc }] = await Promise.all([
      client
        .from('user_verification_subscriptions')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .gt('ends_at', nowIso)
        .limit(1)
        .maybeSingle(),
      client
        .from('user_kyc_submissions')
        .select('status')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const kycApproved = latestKyc?.status === 'approved';
    await client
      .from('users')
      .update({ is_verified: !!activeSub && kycApproved })
      .eq('id', userId);
    await this.invalidateUserVerificationCaches(userId);
  }

  private async invalidateUserVerificationCaches(userId: string) {
    try {
      await this.redis.del(`user:${userId}`);
      await this.redis.del(`user:profile:${userId}`);
      await this.redis.del(`user:stats:${userId}`);
      await this.redis.deletePattern(`user:posts:${userId}:*`);
    } catch (error) {
      this.logger.warn(`Failed to invalidate verification caches for ${userId}: ${error}`);
    }
  }

  async createCardPayment(userId: string, dto: CreateCardPaymentDto) {
    if (!this.apiKey) {
      throw new BadRequestException('Payment provider not configured');
    }

    const idempotencyKey = uuidv4();
    const metadata = {
      user_id: userId,
      kind: dto.kind || 'coin_topup',
      order_id: dto.orderId,
      product: dto.product,
      ...(dto.metadata || {}),
    };

    const cancelUrl = dto.cancelUrl || dto.redirectUrl.replace(/\/[^/]*$/, '/cancelled');
    const payload = {
      payment_type: 'card',
      details: {
        amount: dto.amount,
        currency: dto.currency,
        redirect_url: dto.redirectUrl,
        cancel_url: cancelUrl,
      },
      customer: {
        firstname: dto.customerFirstName,
        lastname: dto.customerLastName,
        email: dto.customerEmail,
      },
      webhook_url: this.webhookUrl || undefined,
      metadata,
    };

    const response = await this.postToSnippe(payload, idempotencyKey);
    await this.logAdminEvent({
      category: 'payment',
      message: `Payment intent created (card) ${response.data.reference}`,
      metadata: { userId, amount: dto.amount, currency: dto.currency, kind: dto.kind, orderId: dto.orderId },
    });
    
    // Extract amount - handle both number and object formats
    const amountValue: any = response.data.amount;
    const amount = typeof amountValue === 'object' && amountValue !== null && 'value' in amountValue
      ? amountValue.value
      : typeof amountValue === 'number'
      ? amountValue
      : Number(amountValue) || 0;
    
    // Extract currency - handle both string and object formats
    const currencyValue: any = response.data.amount;
    const currency = typeof currencyValue === 'object' && currencyValue !== null && 'currency' in currencyValue
      ? currencyValue.currency
      : response.data.currency || 'TZS';
    
    try {
      await this.storeIntent({
        userId,
        reference: response.data.reference,
        status: response.data.status,
        amount,
        currency,
        paymentType: response.data.payment_type,
        paymentUrl: response.data.payment_url,
        expiresAt: response.data.expires_at,
        idempotencyKey,
        phoneNumber: dto.phoneNumber,
        metadata,
      });
      this.logger.log(`✅ Payment intent stored for reference: ${response.data.reference}`);
    } catch (error: any) {
      this.logger.error(`❌ Failed to store payment intent for reference: ${response.data.reference}`, {
        error: error.message,
        stack: error.stack,
      });
      // Don't throw - payment was created, just log the error
    }

    // Check payment status immediately after creation (with small delay for processing)
    setTimeout(async () => {
      try {
        await this.checkAndUpdatePaymentStatus(response.data.reference);
      } catch (error) {
        // Silent fail - cron job will handle it
        this.logger.debug(`Immediate check failed for ${response.data.reference}, will retry via cron`);
      }
    }, 3000); // Check after 3 seconds

    return response;
  }

  async getPaymentStatus(reference: string) {
    const url = `${this.apiUrl}/payments/${reference}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new BadRequestException(text || 'Failed to fetch payment status');
    }
    return res.json();
  }

  /**
   * Check payment status from Snippe API using the list endpoint
   * This is used as a fallback when webhooks fail
   */
  async checkPaymentStatusFromSnippe(reference: string) {
    try {
      // Try to get specific payment first
      const url = `${this.apiUrl}/payments/${reference}`;
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });
      
      if (res.ok) {
        const response = await res.json();
        // Handle both direct data response and wrapped response
        if (response.data && response.data.reference) {
          return response.data;
        }
        if (response.reference) {
          return response;
        }
      }

      // If specific payment fails, try list endpoint and filter by reference
      const listUrl = `${this.apiUrl}/payments/`;
      const listRes = await fetch(listUrl, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (listRes.ok) {
        const response = await listRes.json();
        // Handle response structure: { status, code, data: { payments: [...] } }
        const payments = response?.data?.payments || response?.payments || [];
        const payment = payments.find((p: any) => p.reference === reference);
        if (payment) {
          return payment;
        }
      }

      this.logger.warn(`Payment ${reference} not found in Snippe API`);
      return null;
    } catch (error: any) {
      this.logger.error(`Error checking payment status from Snippe for ${reference}:`, error.message);
      return null;
    }
  }

  /**
   * Check and update a single payment status
   */
  async checkAndUpdatePaymentStatus(reference: string) {
    const client = this.supabase.getClient();
    
    // Get current payment intent from database
    const { data: intent } = await client
      .from('payment_intents')
      .select('*')
      .eq('reference', reference)
      .maybeSingle();

    if (!intent) {
      this.logger.warn(`Payment intent not found for reference: ${reference}`);
      return null;
    }

    // If already completed, skip
    if (intent.status === 'completed') {
      return { reference, status: 'completed', alreadyProcessed: true };
    }

    // Check status from Snippe
    const snippePayment = await this.checkPaymentStatusFromSnippe(reference);
    
    if (!snippePayment) {
      this.logger.warn(`Could not fetch payment status from Snippe for reference: ${reference}`);
      return null;
    }

    const newStatus = this.normalizePaymentStatus(snippePayment?.status);
    
    // Update payment intent status
    await client
      .from('payment_intents')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('reference', reference);

    this.logger.log(`Updated payment ${reference} from ${intent.status} to ${newStatus}`);

    // If payment is now completed, process it
    if (newStatus === 'completed' && intent.status !== 'completed') {
      this.logger.log(`Processing completed payment for reference: ${reference}`);
      await this.handleCompletedPayment(reference, snippePayment);
    }

    // If payment was completed but now failed/reversed, reconcile
    if (intent.status === 'completed' && ['failed', 'reversed', 'voided', 'expired'].includes(newStatus)) {
      this.logger.warn(`Payment ${reference} reversed after completion. Reconciling...`);
      await this.handleReversedPayment(reference, intent, snippePayment);
    }

    // If payment failed/expired and order is still pending, cancel that order.
    if (['failed', 'reversed', 'voided', 'expired', 'cancelled'].includes(newStatus)) {
      const orderId = intent?.metadata?.order_id || snippePayment?.metadata?.order_id;
      if (orderId) {
        await this.markOrderAsUnpaidAndCancel(orderId, `payment_${newStatus}`);
      }
    }

    return { reference, status: newStatus, updated: true };
  }

  /**
   * Check and update all pending payments
   * This is called by the cron job
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async checkPendingPayments() {
    if (!this.apiKey) {
      this.logger.warn('Snippe API key not configured, skipping payment status check');
      return;
    }

    this.logger.log('🔄 Checking pending payments...');
    await this.logAdminEvent({
      category: 'cron',
      message: 'checkPendingPayments',
    });
    const client = this.supabase.getClient();
    
    // Get all pending payments from the last 24 hours
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    const { data: pendingPayments, error } = await client
      .from('payment_intents')
      .select('reference, status, created_at')
      .in('status', ['pending', 'processing'])
      .gte('created_at', oneDayAgo.toISOString())
      .limit(50);

    if (error) {
      this.logger.error('Error fetching pending payments:', error);
      return;
    }

    if (!pendingPayments || pendingPayments.length === 0) {
      this.logger.log('No pending payments to check');
      return;
    }

    this.logger.log(`Found ${pendingPayments.length} pending payments to check`);

    let updatedCount = 0;
    let completedCount = 0;

    // Check each payment status
    for (const payment of pendingPayments) {
      try {
        const result = await this.checkAndUpdatePaymentStatus(payment.reference);
        if (result?.updated) {
          updatedCount++;
          if (result.status === 'completed') {
            completedCount++;
          }
        }
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error: any) {
        this.logger.error(`Error checking payment ${payment.reference}:`, error.message);
      }
    }

    this.logger.log(`✅ Payment check complete: ${updatedCount} updated, ${completedCount} completed`);
  }

  /**
   * Check and update all pending withdrawals (shop + live) from Snippe.
   * Runs every 2 minutes so older pending payouts get status updated even if webhook missed.
   */
  @Cron('0 */2 * * * *') // every 2 minutes
  async checkPendingWithdrawals() {
    if (!this.apiKey) {
      this.logger.warn('Snippe API key not configured, skipping withdrawal status check');
      return;
    }

    const client = this.supabase.getClient();

    // Pending shop withdrawals (any age)
    const { data: pendingShop } = await client
      .from('withdrawals')
      .select('id, reference, status, created_at')
      .eq('status', 'pending')
      .limit(30);

    // Pending live reward withdrawals
    const { data: pendingLive } = await client
      .from('withdrawal_requests')
      .select('id, reference, status, created_at')
      .eq('status', 'pending')
      .limit(30);

    const refs = new Set<string>();
    (pendingShop || []).forEach((r: any) => r?.reference && refs.add(r.reference));
    (pendingLive || []).forEach((r: any) => r?.reference && refs.add(r.reference));

    if (refs.size === 0) {
      return;
    }

    this.logger.log(`🔄 Checking ${refs.size} pending withdrawal(s)...`);

    let updated = 0;
    for (const reference of refs) {
      try {
        const snippe = await this.checkPayoutStatusFromSnippe(reference);
        if (snippe?.status && snippe.status !== 'pending') {
          const status = snippe.status === 'completed' || snippe.status === 'success' ? 'completed' : 'failed';
          await this.syncPayoutStatusInDb(reference, status);
          updated++;
        }
        await new Promise((r) => setTimeout(r, 200));
      } catch (e: any) {
        this.logger.warn(`Check withdrawal ${reference} failed: ${e?.message}`);
      }
    }

    if (updated > 0) {
      this.logger.log(`✅ Withdrawal check: ${updated} updated to final status`);
    }
  }

  /**
   * Expire pending payments older than 1 day
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async expireStalePayments() {
    const client = this.supabase.getClient();
    const timeoutMinutes = Number(this.config.get<string>('ORDER_PAYMENT_TIMEOUT_MIN', '30'));
    const safeTimeoutMinutes = Number.isFinite(timeoutMinutes) && timeoutMinutes > 0 ? timeoutMinutes : 30;
    const cutoff = new Date(Date.now() - safeTimeoutMinutes * 60 * 1000).toISOString();
    await this.logAdminEvent({
      category: 'cron',
      message: 'expireStalePayments',
      metadata: { cutoff, timeoutMinutes: safeTimeoutMinutes },
    });
    try {
      const { data, error } = await client
        .from('payment_intents')
        .update({
          status: 'expired',
          updated_at: new Date().toISOString(),
        })
        .in('status', ['pending', 'processing'])
        .lt('created_at', cutoff)
        .select('reference, metadata');

      if (error) {
        this.logger.error('Error expiring stale payments:', error);
        return;
      }

      if ((data || []).length > 0) {
        this.logger.log(`⏱️ Expired ${data?.length} stale payments`);
        for (const row of data || []) {
          const orderId = (row as any)?.metadata?.order_id;
          if (orderId) {
            await this.markOrderAsUnpaidAndCancel(orderId, 'payment_expired_timeout');
          }
        }
      }
    } catch (e: any) {
      this.logger.error('Error in expireStalePayments:', e.message);
    }
  }

  @Cron('0 0 * * * *') // every 1 hour
  async syncVerificationSubscriptions() {
    const client = this.supabase.getClient();
    const nowIso = new Date().toISOString();
    try {
      const { data: expiredRows } = await client
        .from('user_verification_subscriptions')
        .update({ status: 'expired', updated_at: nowIso })
        .eq('status', 'active')
        .lte('ends_at', nowIso)
        .select('user_id');

      const [{ data: activeSubs }, { data: verifiedUsers }] = await Promise.all([
        client
          .from('user_verification_subscriptions')
          .select('user_id')
          .eq('status', 'active')
          .gt('ends_at', nowIso),
        client
          .from('users')
          .select('id')
          .eq('is_verified', true),
      ]);

      const userIds = Array.from(
        new Set([
          ...((expiredRows || []).map((r: any) => r?.user_id).filter(Boolean)),
          ...((activeSubs || []).map((r: any) => r?.user_id).filter(Boolean)),
          ...((verifiedUsers || []).map((r: any) => r?.id).filter(Boolean)),
        ]),
      );

      for (const userId of userIds) {
        await this.syncUserVerificationFlag(userId);
      }

      this.logger.log(
        `✅ Synced verification subscriptions. Expired rows: ${expiredRows?.length || 0}, users checked: ${userIds.length}`,
      );
    } catch (e: any) {
      this.logger.warn(`Verification subscription sync failed: ${e?.message || e}`);
    }
  }

  private async markOrderAsUnpaidAndCancel(orderId: string, reason: string) {
    if (!orderId) return;
    const client = this.supabase.getClient();
    try {
      const { error } = await client
        .from('orders')
        .update({
          status: 'cancelled',
          payment_issue: true,
          payment_issue_reason: reason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId)
        .eq('status', 'pending');

      if (error) {
        this.logger.warn(`Failed to cancel unpaid order ${orderId}: ${error.message}`);
      }
    } catch (e: any) {
      this.logger.warn(`Failed to cancel unpaid order ${orderId}: ${e?.message}`);
    }
  }

  /**
   * Manually trigger payment status check for a specific reference
   */
  async manualCheckPaymentStatus(reference: string) {
    return this.checkAndUpdatePaymentStatus(reference);
  }

  /**
   * Reconcile failed payments that later completed, and missing credits.
   */
  async reconcilePayments() {
    await this.reconcileFailedPayments();
    await this.reconcileMissingCredits();
    await this.logAdminEvent({
      category: 'cron',
      message: 'reconcilePayments',
    });
    return { success: true };
  }

  /**
   * Get payment status from our database (for frontend polling)
   */
  async getPaymentStatusFromDb(reference: string, userId?: string) {
    const client = this.supabase.getClient();
    let query = client
      .from('payment_intents')
      .select('reference, status, amount, currency, payment_type, created_at, updated_at')
      .eq('reference', reference);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new BadRequestException('Payment not found');
    }

    if (!data) {
      throw new BadRequestException('Payment not found');
    }

    return data;
  }

  async createWithdrawal(userId: string, dto: CreateWithdrawalDto) {
    const client = this.supabase.getClient();
    const snippeMinPayout = 5000; // Snippe API minimum payout amount
    const platformFeeRate = 0.25;
    const withdrawFeeRate = 0.03;
    const totalFeeRate = platformFeeRate + withdrawFeeRate; // 28%
    const minAmountTzs = 10000; // Business minimum displayed in app
    try {
      const amountTzs = Number(dto.amount || 0);
      if (amountTzs <= 0) {
        throw new BadRequestException('Invalid withdrawal amount');
      }
      if (amountTzs < minAmountTzs) {
        throw new BadRequestException(`Minimum withdrawal is TZS ${minAmountTzs.toLocaleString()}`);
      }
      if (this.coinRate <= 0) {
        throw new BadRequestException('Coin rate not configured');
      }

      // Deduct requested amount + fees from wallet balance.
      const grossAmount = amountTzs;
      const platformFeeAmount = amountTzs * platformFeeRate;
      const withdrawFeeAmount = amountTzs * withdrawFeeRate;
      const feeAmount = platformFeeAmount + withdrawFeeAmount;
      const totalDeductionTzs = amountTzs * (1 + totalFeeRate);
      const netAmount = amountTzs;
      const coinsRequired = Math.ceil(totalDeductionTzs * this.coinRate);

      const { data: payoutMethod } = await client
        .from('user_payout_methods')
        .select('provider, phone, full_name')
        .eq('user_id', userId)
        .maybeSingle();

      if (!payoutMethod?.phone || !payoutMethod?.full_name) {
        throw new BadRequestException('Please add a payout method in settings');
      }

      if (netAmount < snippeMinPayout) {
        throw new BadRequestException(`Minimum withdrawal is TZS ${Math.max(minAmountTzs, snippeMinPayout).toLocaleString()}`);
      }

      const { data: walletRow } = await client
        .from('coin_wallets')
        .select('balance')
        .eq('user_id', userId)
        .maybeSingle();
      const availableCoins = Number(walletRow?.balance ?? 0);
      if (availableCoins < coinsRequired) {
        throw new BadRequestException(
          `Not enough reward balance. Required: ${coinsRequired.toLocaleString()} coins (TZS ${Math.ceil(totalDeductionTzs).toLocaleString()} incl. 25% platform + 3% withdraw fee). Available: ${availableCoins.toLocaleString()} coins.`,
        );
      }

      const { data: newBalance, error } = await client.rpc('decrement_coin_balance', {
        p_user_id: userId,
        p_amount: coinsRequired,
      });
      if (error) {
        throw error;
      }

      const idempotencyKey = uuidv4();
      const recipientPhone = this.normalizePhoneForPayout(payoutMethod.phone);
      const payoutPayload = {
        amount: Math.round(netAmount),
        channel: 'mobile',
        recipient_phone: recipientPhone,
        recipient_name: (payoutMethod.full_name || '').trim(),
        narration: 'Live rewards withdrawal',
        webhook_url: this.payoutWebhookUrl || undefined,
        metadata: {
          user_id: userId,
          gross_amount: grossAmount,
          total_deduction_tzs: totalDeductionTzs,
          platform_fee_amount: platformFeeAmount,
          withdraw_fee_amount: withdrawFeeAmount,
          fee_amount: feeAmount,
          net_amount: netAmount,
          coin_amount: coinsRequired,
          provider: payoutMethod.provider,
        },
      };

      let payoutResponse: any;
      try {
        payoutResponse = await this.postToSnippePayout(payoutPayload, idempotencyKey);
      } catch (payoutErr: any) {
        // Payout request failed -> refund deducted coins immediately.
        const { data: refundedBalance } = await client.rpc('increment_coin_balance', {
          p_user_id: userId,
          p_amount: coinsRequired,
        });
        await client.from('coin_transactions').insert({
          user_id: userId,
          amount: Math.abs(coinsRequired),
          type: 'adjustment',
          status: 'completed',
          reference: idempotencyKey,
          metadata: { reason: 'payout_request_failed_refund' },
        });
        if (typeof refundedBalance === 'number') {
          await this.syncFirestoreWallet(userId, refundedBalance);
        }
        throw new BadRequestException(payoutErr?.message || 'Unable to create withdrawal');
      }

      const payoutData = payoutResponse?.data || payoutResponse;
      const reference = payoutData?.reference || payoutData?.data?.reference || idempotencyKey;
      const status = this.extractPayoutStatus(payoutData) || payoutData?.status || 'pending';

      const { error: withdrawalError } = await client.from('withdrawal_requests').insert({
        user_id: userId,
        amount: coinsRequired,
        currency: 'TZS',
        method: 'mobile',
        account: payoutMethod.phone,
        status,
        provider: 'snippe',
        reference,
        fee_amount: feeAmount,
        net_amount: netAmount,
        metadata: {
          ...(dto.metadata || {}),
          gross_amount: grossAmount,
          total_deduction_tzs: totalDeductionTzs,
          total_fee_rate: totalFeeRate,
          platform_fee_amount: platformFeeAmount,
          withdraw_fee_amount: withdrawFeeAmount,
          coin_amount: coinsRequired,
          provider: payoutMethod.provider,
          recipient_name: payoutMethod.full_name,
        },
      });
      if (withdrawalError) {
        this.logger.error(`Failed to store withdrawal request ${reference}: ${withdrawalError.message}`);
      }

      const { error: txError } = await client.from('coin_transactions').insert({
        user_id: userId,
        amount: -Math.abs(coinsRequired),
        type: 'withdraw',
        status,
        reference,
        metadata: {
          ...(dto.metadata || {}),
          net_amount: netAmount,
          gross_amount: grossAmount,
          total_deduction_tzs: totalDeductionTzs,
          platform_fee_amount: platformFeeAmount,
          withdraw_fee_amount: withdrawFeeAmount,
          fee_amount: feeAmount,
        },
      });
      if (txError) {
        this.logger.error(`Failed to store withdrawal coin transaction ${reference}: ${txError.message}`);
      }

      if (typeof newBalance === 'number') {
        await this.syncFirestoreWallet(userId, newBalance);
      }

      return {
        success: true,
        reference,
        status,
        coinAmount: coinsRequired,
        grossAmount,
        feeAmount,
        netAmount,
      };
    } catch (e: any) {
      if ((e?.message || '').includes('insufficient_balance')) {
        throw new BadRequestException('Not enough coins');
      }
      if (e instanceof BadRequestException) {
        throw e;
      }
      const message = (e?.message || '').toString().trim();
      if (message.length > 0) {
        throw new BadRequestException(message);
      }
      throw new BadRequestException('Unable to create withdrawal');
    }
  }

  async createShopWithdrawal(userId: string, dto: {
    amount: number;
    channel: string;
    recipientPhone: string;
    recipientName: string;
    narration?: string;
  }) {
    const minAmount = 10000;
    const feeRate = 0.07; // 7% total withdrawal fee
    const withdrawFeeRate = 0;
    if (dto.amount < minAmount) {
      throw new BadRequestException(`Minimum withdrawal is ${minAmount}`);
    }

    const client = this.supabase.getClient();
    const { data: shop } = await client
      .from('shops')
      .select('id, shop_name')
      .eq('user_id', userId)
      .maybeSingle();

    if (!shop?.id) {
      throw new BadRequestException('Shop not found');
    }

    const totalFeeRate = feeRate + withdrawFeeRate;
    const feeAmount = Math.ceil(dto.amount * totalFeeRate);
    const netAmount = dto.amount - feeAmount;
    if (netAmount <= 0) {
      throw new BadRequestException('Invalid withdrawal amount');
    }

    const { data: payoutMethod } = await client
      .from('shop_payout_methods')
      .select('provider, phone, full_name')
      .eq('shop_id', shop.id)
      .maybeSingle();

    if (!payoutMethod?.phone || !payoutMethod?.full_name) {
      throw new BadRequestException('Please add a shop payout method in settings');
    }

    // Use same available balance as UI: delivered orders total - completed withdrawals
    const { data: revenueRows } = await client
      .from('orders')
      .select('total_amount')
      .eq('shop_id', shop.id)
      .eq('status', 'delivered');
    const revenue = (revenueRows || []).reduce((s, r) => s + Number(r?.total_amount ?? 0), 0);

    const { data: withdrawnRows } = await client
      .from('withdrawals')
      .select('amount')
      .eq('shop_id', shop.id)
      .eq('status', 'completed');
    const withdrawn = (withdrawnRows || []).reduce((s, w) => s + Number(w?.amount ?? 0), 0);

    const availableBalance = revenue - withdrawn;
    if (availableBalance < dto.amount) {
      throw new BadRequestException('Not enough shop balance');
    }

    // Ensure shop_wallets is in sync with revenue - withdrawals (e.g. if wallet was never credited)
    const { data: walletRow } = await client
      .from('shop_wallets')
      .select('balance')
      .eq('shop_id', shop.id)
      .maybeSingle();
    const walletBalance = Number(walletRow?.balance ?? 0);
    if (walletBalance < dto.amount) {
      const topUp = availableBalance - walletBalance;
      if (topUp > 0) {
        const { error: syncErr } = await client.rpc('increment_shop_balance', {
          p_shop_id: shop.id,
          p_amount: topUp,
        });
        if (syncErr) {
          this.logger.warn('Shop wallet sync before withdrawal failed:', syncErr?.message);
        }
      }
    }

    const { data: newBalance, error: balanceError } = await client.rpc('decrement_shop_balance', {
      p_shop_id: shop.id,
      p_amount: dto.amount,
    });

    if (balanceError) {
      if ((balanceError?.message || '').includes('insufficient_balance')) {
        throw new BadRequestException('Not enough shop balance');
      }
      throw new BadRequestException('Unable to process withdrawal');
    }

    const idempotencyKey = uuidv4();
    const recipientPhone = this.normalizePhoneForPayout(payoutMethod.phone);
    const payoutPayload = {
      amount: netAmount,
      channel: 'mobile',
      recipient_phone: recipientPhone,
      recipient_name: (payoutMethod.full_name || '').trim(),
      narration: (dto.narration || `Shop withdrawal ${shop.shop_name || ''}`.trim()).slice(0, 255),
      webhook_url: this.payoutWebhookUrl || undefined,
      metadata: {
        shop_id: shop.id,
        user_id: userId,
        gross_amount: dto.amount,
        fee_amount: feeAmount,
        withdraw_fee_amount: Math.ceil(dto.amount * withdrawFeeRate),
        platform_fee_amount: Math.ceil(dto.amount * feeRate),
        net_amount: netAmount,
      },
    };

    let payoutResponse: any;
    try {
      payoutResponse = await this.postToSnippePayout(payoutPayload, idempotencyKey);
    } catch (err: any) {
      this.logger.error(`Shop withdrawal Snippe failed: ${err?.message}`, err?.stack);
      throw err;
    }
    const payoutData = payoutResponse?.data || payoutResponse;
    const reference = payoutData?.reference || payoutData?.data?.reference;
    const status = payoutData?.status || 'pending';

    await client.from('withdrawals').insert({
      shop_id: shop.id,
      user_id: userId,
      amount: dto.amount,
      payment_method: 'mobile',
      account_details: payoutMethod.phone,
      status,
      provider: 'snippe',
      reference,
      fee_amount: feeAmount,
      net_amount: netAmount,
      metadata: {
        recipient_name: payoutMethod.full_name,
        provider: payoutMethod.provider,
        narration: dto.narration,
        withdraw_fee_amount: Math.ceil(dto.amount * withdrawFeeRate),
        platform_fee_amount: Math.ceil(dto.amount * feeRate),
      },
    });

    await this.logAdminEvent({
      category: 'withdrawal',
      message: `Shop withdrawal created ${reference}`,
      metadata: { shopId: shop.id, amount: dto.amount, feeAmount, netAmount, channel: dto.channel },
    });

    return {
      reference,
      status,
      grossAmount: dto.amount,
      feeAmount,
      netAmount,
      newBalance,
    };
  }

  async getWalletSummary(userId: string) {
    const client = this.supabase.getClient();
    
    // Ensure wallet exists - create if it doesn't
    const { data: wallet, error: walletError } = await client
      .from('coin_wallets')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle();
    
    // If wallet doesn't exist, create it with 0 balance
    if (!wallet && !walletError) {
      await client
        .from('coin_wallets')
        .insert({ user_id: userId, balance: 0 })
        .select('balance')
        .single();
    }
    
    const [{ data: transactions }, { data: withdrawals }] = await Promise.all([
      client
        .from('coin_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50),
      client
        .from('withdrawal_requests')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    const txList = (transactions as any[]) || [];
    let income = 0;
    let spent = 0;
    let giftIncome = 0;
    for (const tx of txList) {
      const amount = Number(tx.amount || 0);
      if (amount > 0) {
        income += amount;
        if (tx.type === 'gift') giftIncome += amount;
      } else {
        spent += Math.abs(amount);
      }
    }

    // Get the wallet balance (either from existing wallet or 0 if creation failed)
    const { data: finalWallet } = await client
      .from('coin_wallets')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle();

    return {
      balance: Number(finalWallet?.balance || 0),
      income,
      giftIncome,
      spent,
      transactions: txList,
      withdrawals: withdrawals || [],
    };
  }

  async getWithdrawalStatus(reference: string, userId: string) {
    const client = this.supabase.getClient();
    const { data: live } = await client
      .from('withdrawal_requests')
      .select('reference, status, amount, net_amount, fee_amount, created_at')
      .eq('reference', reference)
      .eq('user_id', userId)
      .maybeSingle();

    if (live?.reference) {
      if ((live.status ?? '').toString().toLowerCase() === 'pending') {
        const snippe = await this.checkPayoutStatusFromSnippe(reference);
        if (snippe?.status && snippe.status !== 'pending') {
          const status = snippe.status === 'completed' || snippe.status === 'success' ? 'completed' : 'failed';
          await this.syncPayoutStatusInDb(reference, status);
          const { data: updated } = await client
            .from('withdrawal_requests')
            .select('reference, status, amount, net_amount, fee_amount, created_at')
            .eq('reference', reference)
            .eq('user_id', userId)
            .maybeSingle();
          if (updated) return { type: 'live', ...updated };
        }
      }
      return { type: 'live', ...live };
    }

    const { data: shop } = await client
      .from('withdrawals')
      .select('reference, status, amount, net_amount, fee_amount, created_at')
      .eq('reference', reference)
      .eq('user_id', userId)
      .maybeSingle();

    if (shop?.reference) {
      if ((shop.status ?? '').toString().toLowerCase() === 'pending') {
        const snippe = await this.checkPayoutStatusFromSnippe(reference);
        if (snippe?.status && snippe.status !== 'pending') {
          const status = snippe.status === 'completed' || snippe.status === 'success' ? 'completed' : 'failed';
          await this.syncPayoutStatusInDb(reference, status);
          const { data: updated } = await client
            .from('withdrawals')
            .select('reference, status, amount, net_amount, fee_amount, created_at')
            .eq('reference', reference)
            .eq('user_id', userId)
            .maybeSingle();
          if (updated) return { type: 'shop', ...updated };
        }
      }
      return { type: 'shop', ...shop };
    }

    throw new BadRequestException('Withdrawal not found');
  }

  async sendGift(senderId: string, dto: CreateGiftTransferDto) {
    if (senderId === dto.receiverId) {
      throw new BadRequestException('Cannot send gift to yourself');
    }
    const resolvedGift = this.resolveGiftCatalogItem(dto);
    if (!resolvedGift) {
      throw new BadRequestException('Unsupported gift');
    }
    const client = this.supabase.getClient();
    try {
      const { data: senderBalance, error } = await client.rpc('decrement_coin_balance', {
        p_user_id: senderId,
        p_amount: resolvedGift.coinCost,
      });
      if (error) {
        throw error;
      }

      const { data: receiverBalance } = await client.rpc('increment_coin_balance', {
        p_user_id: dto.receiverId,
        p_amount: resolvedGift.coinCost,
      });

      const metadata = {
        giftId: resolvedGift.id,
        giftName: resolvedGift.name,
        giftIcon: resolvedGift.icon,
        liveId: dto.liveId,
        receiverId: dto.receiverId,
        senderId,
      };

      await client.from('coin_transactions').insert([
        {
          user_id: senderId,
          amount: -Math.abs(resolvedGift.coinCost),
          type: 'gift',
          status: 'completed',
          metadata: { ...metadata, direction: 'sent' },
        },
        {
          user_id: dto.receiverId,
          amount: Math.abs(resolvedGift.coinCost),
          type: 'gift',
          status: 'completed',
          metadata: { ...metadata, direction: 'received' },
        },
      ]);

      await this.logAdminEvent({
        category: 'gift',
        message: `Gift sent ${resolvedGift.name}`.trim(),
        metadata: { senderId, receiverId: dto.receiverId, coinCost: resolvedGift.coinCost, liveId: dto.liveId, giftId: resolvedGift.id },
      });

      if (typeof senderBalance === 'number') {
        await this.syncFirestoreWallet(senderId, senderBalance);
      }
      if (typeof receiverBalance === 'number') {
        await this.syncFirestoreWallet(dto.receiverId, receiverBalance);
      }

      return {
        senderBalance,
        receiverBalance,
        gift: resolvedGift,
      };
    } catch (e: any) {
      await this.logAdminEvent({
        level: 'error',
        category: 'gift',
        message: 'Gift transfer failed',
        metadata: { senderId, receiverId: dto.receiverId, coinCost: resolvedGift.coinCost, giftId: resolvedGift.id, error: e?.message },
      });
      if ((e?.message || '').includes('insufficient_balance')) {
        throw new BadRequestException('Not enough coins');
      }
      throw new BadRequestException('Unable to send gift');
    }
  }

  async handleWebhook(rawBody: Buffer | string, headers: Record<string, any>) {
    this.logger.log('🔔 Webhook received:', {
      event: headers['x-webhook-event'] || headers['X-Webhook-Event'],
      timestamp: headers['x-webhook-timestamp'] || headers['X-Webhook-Timestamp'],
      userAgent: headers['user-agent'] || headers['User-Agent'],
    });

    try {
      // Parse webhook body
      const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));
      
      // Extract event type and data from Snippe webhook format
      const eventType =
        body.type ||
        body.event ||
        body.name ||
        headers['x-webhook-event'] ||
        headers['X-Webhook-Event'];
      const webhookData = body.data || body;
      const reference = this.extractPaymentReference(body, webhookData);
      const status = this.normalizePaymentStatus(
        webhookData.status ||
          (eventType === 'payment.completed'
            ? 'completed'
            : eventType === 'payment.failed'
              ? 'failed'
              : 'unknown'),
      );

      this.logger.log('📦 Webhook payload:', {
        eventType,
        reference,
        status,
        amount: webhookData.amount?.value || webhookData.amount,
        currency: webhookData.amount?.currency || webhookData.currency,
        metadata: webhookData.metadata,
        fullWebhookData: JSON.stringify(webhookData, null, 2),
      });

      if (!reference) {
        this.logger.error('❌ Webhook missing reference');
        throw new BadRequestException('Missing payment reference');
      }

      // Read current intent for reconciliation
      const client = this.supabase.getClient();
      const { data: existingIntent } = await client
        .from('payment_intents')
        .select('*')
        .eq('reference', reference)
        .maybeSingle();

      // Update payment intent status
      const updateResult = await client
        .from('payment_intents')
        .update({
          status,
          updated_at: new Date().toISOString(),
        })
        .eq('reference', reference)
        .select();

      this.logger.log(`✅ Updated payment intent ${reference} to status: ${status}`, {
        rowsUpdated: updateResult.data?.length || 0,
      });

      // Handle payout webhooks (payout.completed, payout.failed, payout.reversed, payout.updated, etc.)
      const payoutEvent = eventType?.toString().toLowerCase();
      if (payoutEvent?.startsWith('payout.') || payoutEvent === 'transfer.completed' || payoutEvent === 'transfer.failed') {
        await this.handlePayoutWebhook(reference, eventType, webhookData);
        return { received: true, eventType, reference, status };
      }

      // Process based on event type
      if (eventType === 'payment.completed' || status === 'completed') {
        this.logger.log(`💰 Processing completed payment for reference: ${reference}`);
        // Get the updated payment intent or use webhook data
        const updatedIntent = updateResult.data?.[0];
        if (updatedIntent) {
          await this.handleCompletedPayment(reference, { ...webhookData, ...updatedIntent });
        } else {
          // If payment intent not found, try to process with webhook data only
          this.logger.warn(`⚠️  Payment intent not found in DB, processing with webhook data only for reference: ${reference}`);
          await this.handleCompletedPayment(reference, webhookData);
        }
        this.logger.log(`✅ Completed payment processed successfully for reference: ${reference}`);
      } else if (
        eventType === 'payment.failed' ||
        eventType === 'payment.reversed' ||
        status === 'failed' ||
        status === 'reversed'
      ) {
        this.logger.log(`❌ Payment failed for reference: ${reference}`, {
          failureReason: webhookData.failure_reason,
        });
        if (existingIntent?.status === 'completed') {
          await this.handleReversedPayment(reference, existingIntent, webhookData);
        }
      }

      return { received: true, eventType, reference, status };
    } catch (error: any) {
      this.logger.error('❌ Webhook processing error:', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Fetch payout status from Snippe API (used when webhook is missed or not configured).
   */
  private async checkPayoutStatusFromSnippe(reference: string): Promise<{ status: string } | null> {
    if (!this.apiKey) return null;
    try {
      // Try GET /payouts/:reference first
      const url = `${this.apiUrl}/payouts/${reference}`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      const raw = await res.json().catch(() => ({}));
      const status = this.extractPayoutStatus(raw);
      if (status) {
        this.logger.log(`Snippe payout ${reference} status: ${status}`);
        return { status };
      }
      // Fallback: list payouts and find by reference
      const listUrl = `${this.apiUrl}/payouts`;
      const listRes = await fetch(listUrl, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      if (listRes.ok) {
        const listRaw = await listRes.json().catch(() => ({}));
        const list = listRaw?.data?.payouts ?? listRaw?.data ?? listRaw?.payouts ?? (Array.isArray(listRaw) ? listRaw : []);
        const found = Array.isArray(list) ? list.find((p: any) => (p.reference ?? p.id ?? p.reference_id) === reference) : null;
        if (found) {
          const foundStatus = this.extractPayoutStatus(found) ?? this.extractPayoutStatus({ data: found });
          if (foundStatus) {
            this.logger.log(`Snippe payout ${reference} status (from list): ${foundStatus}`);
            return { status: foundStatus };
          }
        }
      }
      return null;
    } catch (e: any) {
      this.logger.warn(`Check payout status from Snippe failed for ${reference}: ${e?.message}`);
      return null;
    }
  }

  /** Extract and normalize payout status from various Snippe response shapes. */
  private extractPayoutStatus(obj: any): string | null {
    if (!obj) return null;
    const s = (obj?.data?.status ?? obj?.status ?? obj?.data?.state ?? obj?.state)?.toString()?.toLowerCase();
    if (!s) return null;
    if (['completed', 'success', 'delivered', 'paid', 'done', 'settled'].includes(s)) return 'completed';
    if (['failed', 'reversed', 'rejected', 'expired', 'voided', 'cancelled'].includes(s)) return 'failed';
    return s;
  }

  /** Update withdrawals/withdrawal_requests and optional refunds by reference and status. */
  private async syncPayoutStatusInDb(reference: string, payoutStatus: string) {
    const client = this.supabase.getClient();

    const { data: shopWithdrawal } = await client
      .from('withdrawals')
      .select('id, shop_id, amount, status')
      .eq('reference', reference)
      .maybeSingle();

    if (shopWithdrawal?.id) {
      await client
        .from('withdrawals')
        .update({ status: payoutStatus, updated_at: new Date().toISOString() })
        .eq('id', shopWithdrawal.id);

      if (payoutStatus === 'failed' && shopWithdrawal.shop_id) {
        await client.rpc('increment_shop_balance', {
          p_shop_id: shopWithdrawal.shop_id,
          p_amount: shopWithdrawal.amount,
        });
      }
    }

    const { data: withdrawal } = await client
      .from('withdrawal_requests')
      .select('id, user_id, amount, status')
      .eq('reference', reference)
      .maybeSingle();

    if (withdrawal?.id) {
      await client
        .from('withdrawal_requests')
        .update({ status: payoutStatus, updated_at: new Date().toISOString() })
        .eq('id', withdrawal.id);

      await client
        .from('coin_transactions')
        .update({ status: payoutStatus })
        .eq('reference', reference)
        .eq('type', 'withdraw');

      if (payoutStatus === 'failed' && withdrawal.user_id && withdrawal.amount) {
        const { data: newBalance } = await client.rpc('increment_coin_balance', {
          p_user_id: withdrawal.user_id,
          p_amount: withdrawal.amount,
        });
        await client.from('coin_transactions').insert({
          user_id: withdrawal.user_id,
          amount: Math.abs(withdrawal.amount),
          type: 'adjustment',
          status: 'completed',
          reference,
          metadata: { reason: 'payout_failed' },
        });
        if (typeof newBalance === 'number') {
          await this.syncFirestoreWallet(withdrawal.user_id, newBalance);
        }
      }
    }
  }

  private async handlePayoutWebhook(reference: string, eventType: string, webhookData: any) {
    const ev = (eventType ?? '').toString().toLowerCase();
    const bodyStatus = (webhookData?.status ?? '').toString().toLowerCase();
    const payoutStatus =
      ev === 'payout.completed' || ev === 'transfer.completed' || bodyStatus === 'completed' || bodyStatus === 'success'
        ? 'completed'
        : ev === 'payout.failed' || ev === 'payout.reversed' || ev === 'transfer.failed' || bodyStatus === 'failed' || bodyStatus === 'reversed'
          ? 'failed'
          : bodyStatus || 'pending';
    this.logger.log(`Payout webhook: reference=${reference} eventType=${eventType} -> status=${payoutStatus}`);
    await this.syncPayoutStatusInDb(reference, payoutStatus);
  }

  private async handleCompletedPayment(reference: string, payload: any) {
    this.logger.log(`🔄 Processing completed payment for reference: ${reference}`);
    const client = this.supabase.getClient();
    
    // Try to fetch payment intent from database
    const { data: intent, error: intentError } = await client
      .from('payment_intents')
      .select('user_id, amount, currency, metadata')
      .eq('reference', reference)
      .maybeSingle();

    // If not found in DB, use payload data (from webhook or update result)
    const finalIntent = intent || {
      user_id: payload.user_id,
      amount: payload.amount?.value || payload.amount,
      currency: payload.amount?.currency || payload.currency,
      metadata: payload.metadata || {},
    };

    const metadata = finalIntent.metadata || payload.metadata || {};
    const userId = metadata.user_id || finalIntent.user_id || payload.user_id;
    
    if (!userId) {
      this.logger.error('❌ No user_id found in payment intent or metadata:', { reference, metadata, intent });
      return;
    }

    this.logger.log(`👤 Processing payment for user: ${userId}`, {
      amount: finalIntent.amount,
      currency: finalIntent.currency,
      metadata,
    });

    if (metadata.order_id) {
      await client
        .from('orders')
        .update({ status: 'processing', updated_at: new Date().toISOString(), payment_issue: false })
        .eq('id', metadata.order_id);
      this.logger.log(`✅ Updated order ${metadata.order_id} to processing`);
    }

    if (metadata.kind === 'shop_order' || metadata.order_id) {
      await this.creditShopWalletForOrder({
        orderId: metadata.order_id,
        reference,
        fallbackAmount: Number(finalIntent.amount || payload.amount?.value || payload.amount || 0),
        currency: finalIntent.currency || payload.currency || 'TZS',
        metadata,
      });
    }

    if (metadata.kind === 'verification_subscription') {
      await this.activateVerificationSubscriptionFromPayment({
        userId,
        reference,
        amountTzs: Number(finalIntent.amount || payload.amount?.value || payload.amount || 0),
        metadata,
      });
      this.logger.log(`✅ Verification subscription activated from payment ${reference}`);
      return;
    }

    if (metadata.kind === 'shop_advertisement') {
      await this.activateShopAdvertisementFromPayment({
        userId,
        reference,
        metadata,
      });
      this.logger.log(`✅ Shop advertisement activated from payment ${reference}`);
      return;
    }

    if (metadata.kind === 'coin_topup') {
      // Check if transaction already exists (prevent duplicate processing)
      const { data: existing } = await client
        .from('coin_transactions')
        .select('id')
        .eq('reference', reference)
        .eq('type', 'deposit')
        .maybeSingle();
      
      if (existing) {
        this.logger.log(`⚠️  Transaction already processed for reference: ${reference}`);
        return;
      }

      // Use expected coins from bundle metadata when present, otherwise calculate from amount × rate
      const paymentAmount = Number(
        payload.amount?.value ||
        payload.amount ||
        finalIntent.amount ||
        0
      );
      const expectedCoins = Number(metadata.coins) || 0;
      const coins = expectedCoins > 0
        ? expectedCoins
        : Math.floor(paymentAmount * this.coinRate);

      this.logger.log(`💰 Converting payment to coins:`, {
        paymentAmount,
        coinRate: this.coinRate,
        expectedCoins: expectedCoins || undefined,
        coins,
      });

      // Increment user's coin balance
      const { data: newBalance, error: balanceError } = await client.rpc('increment_coin_balance', {
        p_user_id: userId,
        p_amount: coins,
      });

      if (balanceError) {
        this.logger.error('❌ Error incrementing coin balance:', balanceError);
        throw new BadRequestException('Failed to update coin balance');
      }

      this.logger.log(`✅ Coin balance updated for user ${userId}:`, {
        coinsAdded: coins,
        newBalance,
      });

      // Create transaction record
      const { error: txError } = await client.from('coin_transactions').insert({
        user_id: userId,
        amount: coins,
        type: 'deposit',
        status: 'completed',
        reference,
        metadata,
      });

      if (txError) {
        this.logger.error('❌ Error creating coin transaction:', txError);
        throw new BadRequestException('Failed to create transaction record');
      }

      this.logger.log(`✅ Coin transaction created for user ${userId}`);
      await this.logAdminEvent({
        category: 'coin',
        message: `Coin topup completed ${reference}`,
        metadata: { userId, coins, amount: paymentAmount, orderId: metadata.order_id },
      });

      // Sync to Firestore if available
      if (typeof newBalance === 'number') {
        await this.syncFirestoreWallet(userId, newBalance);
        this.logger.log(`✅ Firestore wallet synced for user ${userId}`);
      }
    } else {
      this.logger.log(`ℹ️  Payment kind is not coin_topup, skipping coin processing:`, metadata.kind);
    }
  }

  private normalizePaymentStatus(raw: any): string {
    const s = String(raw || '').toLowerCase().trim();
    if (['completed', 'success', 'succeeded', 'paid', 'delivered', 'done', 'settled'].includes(s)) {
      return 'completed';
    }
    if (['failed', 'reversed', 'rejected', 'expired', 'voided', 'cancelled', 'canceled'].includes(s)) {
      return s === 'canceled' ? 'cancelled' : s;
    }
    if (['processing', 'pending', 'initiated', 'created', 'queued'].includes(s)) {
      return 'pending';
    }
    return s || 'unknown';
  }

  private async activateShopAdvertisementFromPayment(input: {
    userId: string;
    reference: string;
    metadata: Record<string, any>;
  }) {
    const client = this.supabase.getClient();
    const { userId, reference, metadata } = input;

    const shopId = (metadata.shop_id || '').toString();
    const productId = (metadata.product_id || '').toString();
    if (!shopId || !productId) {
      this.logger.warn(
        `shop_advertisement activation skipped: missing shop_id/product_id for ${reference}`,
      );
      return;
    }

    try {
      const { data: existing } = await client
        .from('shop_ads')
        .select('id')
        .eq('payment_reference', reference)
        .maybeSingle();
      if (existing?.id) {
        return;
      }
    } catch (e: any) {
      const msg = (e?.message || '').toString().toLowerCase();
      if (!msg.includes('payment_reference')) {
        this.logger.warn(`shop_advertisement existing-check failed: ${e?.message || e}`);
      }
    }

    const durationDays = Math.max(1, Number(metadata.duration_days || 1));
    const placementsRaw = metadata.placements;
    const placements = Array.isArray(placementsRaw)
      ? placementsRaw.map((p: any) => String(p)).filter(Boolean)
      : ['shop'];
    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const rowWithRef = {
      shop_id: shopId,
      product_id: productId,
      created_by: userId,
      status: 'active',
      placements: placements.length ? placements : ['shop'],
      headline: metadata.headline ? String(metadata.headline) : String(metadata.goal_label || 'Get sales'),
      cta_text: 'Shop Now',
      daily_budget_tzs: Number(metadata.daily_budget_tzs || 0),
      total_budget_tzs: Number(metadata.total_budget_tzs || 0),
      bid_per_click_tzs: Number(metadata.bid_per_click_tzs || 0),
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      payment_reference: reference,
    };

    try {
      const { error } = await client.from('shop_ads').insert(rowWithRef);
      if (error) {
        const msg = (error.message || '').toLowerCase();
        // If payment_reference constraint fails (duplicate reference),
        // we assume the ad is already active and do NOT insert another row.
        if (msg.includes('payment_reference')) {
          this.logger.warn(
            `Shop advertisement for reference ${reference} already exists (payment_reference conflict); skipping duplicate insert.`,
          );
          return;
        }

        this.logger.error(
          `Failed to activate shop_advertisement ${reference}: ${error.message}`,
        );
      }
    } catch (e: any) {
      this.logger.error(
        `Failed to activate shop_advertisement ${reference}: ${e?.message || e}`,
      );
    }
  }

  private extractPaymentReference(body: any, webhookData: any): string | undefined {
    return (
      webhookData?.reference ||
      webhookData?.payment_reference ||
      webhookData?.reference_id ||
      body?.reference ||
      body?.payment_reference ||
      body?.reference_id ||
      webhookData?.metadata?.reference ||
      body?.metadata?.reference
    );
  }

  private async creditShopWalletForOrder(input: {
    orderId?: string;
    reference: string;
    fallbackAmount: number;
    currency: string;
    metadata: Record<string, any>;
  }) {
    const { orderId, reference, fallbackAmount, currency, metadata } = input;
    if (!orderId) {
      this.logger.warn('Shop wallet credit skipped: missing order_id');
      return;
    }

    const client = this.supabase.getClient();

    const { data: existingTx } = await client
      .from('shop_transactions')
      .select('id')
      .eq('reference', reference)
      .maybeSingle();

    if (existingTx) {
      this.logger.log(`⚠️  Shop transaction already processed for reference: ${reference}`);
      return;
    }

    const { data: order, error: orderError } = await client
      .from('orders')
      .select('id, shop_id, total_amount, buyer_id')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError || !order) {
      this.logger.warn(`Order not found for shop wallet credit: ${orderId}`);
      return;
    }

    const amount = Number(order.total_amount || fallbackAmount || 0);
    if (!amount || amount <= 0) {
      this.logger.warn(`Shop wallet credit skipped: invalid amount for order ${orderId}`);
      return;
    }

    const { data: shop } = await client
      .from('shops')
      .select('id, shop_name, user_id')
      .eq('id', order.shop_id)
      .maybeSingle();

    if (!shop?.id || !shop?.user_id) {
      this.logger.warn(`Shop not found for order ${orderId}`);
      return;
    }

    const { data: newBalance, error: balanceError } = await client.rpc('increment_shop_balance', {
      p_shop_id: shop.id,
      p_amount: amount,
    });

    if (balanceError) {
      this.logger.error('❌ Error incrementing shop balance:', balanceError);
      throw new BadRequestException('Failed to update shop balance');
    }

    const { error: txError } = await client.from('shop_transactions').insert({
      shop_id: shop.id,
      order_id: order.id,
      amount,
      type: 'sale',
      status: 'completed',
      reference,
      metadata: {
        currency,
        buyer_id: order.buyer_id,
        order_id: order.id,
        ...metadata,
      },
    });

    if (txError) {
      this.logger.error('❌ Error creating shop transaction:', txError);
    } else {
      this.logger.log(`✅ Shop wallet credited for order ${orderId}`, {
        amount,
        newBalance,
      });
    }

    await this._updateSoldCounts(order.id);
    await this._notifyOrderPaid(order, shop, amount, currency);

    const productSummary = await this.getOrderProductSummary(order.id);

    await this.sendShopPaymentEmail({
      shopId: shop.id,
      shopName: shop.shop_name,
      ownerId: shop.user_id,
      amount,
      currency,
      orderId: order.id,
      reference,
      productSummary,
    });

    await this.sendBuyerPaymentEmail({
      buyerId: order.buyer_id,
      orderId: order.id,
      amount,
      currency,
      reference,
      productSummary,
    });

    await this.logAdminEvent({
      category: 'shop_order',
      message: `Order paid ${order.id}`,
      metadata: { orderId: order.id, shopId: shop.id, amount, currency },
    });
  }

  private async handleReversedPayment(reference: string, intent: any, payload: any) {
    const client = this.supabase.getClient();
    const metadata = intent?.metadata || payload?.metadata || {};
    const userId = metadata.user_id || intent.user_id || payload.user_id;
    const amountValue = payload?.amount?.value || payload?.amount || intent.amount || 0;
    const paymentAmount = Number(amountValue || 0);

    if (metadata.kind === 'coin_topup' && userId) {
      const { data: existingAdjustment } = await client
        .from('coin_transactions')
        .select('id')
        .eq('reference', reference)
        .eq('type', 'adjustment')
        .maybeSingle();

      if (!existingAdjustment) {
        const expectedCoins = Number(metadata.coins) || 0;
        const coins = expectedCoins > 0
          ? expectedCoins
          : Math.floor(paymentAmount * this.coinRate);
        try {
          await client.rpc('decrement_coin_balance', {
            p_user_id: userId,
            p_amount: coins,
          });
        } catch (e: any) {
          this.logger.error('❌ Failed to reverse coin balance:', e.message);
        }
        await client.from('coin_transactions').insert({
          user_id: userId,
          amount: -Math.abs(coins),
          type: 'adjustment',
          status: 'completed',
          reference,
          metadata: { reason: 'payment_reversed', ...metadata },
        });
      }
    }

    if (metadata.order_id) {
      await client
        .from('orders')
        .update({
          payment_issue: true,
          payment_issue_reason: 'payment_reversed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', metadata.order_id);

      const { data: order } = await client
        .from('orders')
        .select('id, shop_id, buyer_id, total_amount')
        .eq('id', metadata.order_id)
        .maybeSingle();

      if (order?.shop_id) {
        const { data: existingRefund } = await client
          .from('shop_transactions')
          .select('id')
          .eq('reference', reference)
          .eq('type', 'refund')
          .maybeSingle();

        if (!existingRefund) {
          const refundAmount = Number(order.total_amount || paymentAmount || 0);
          try {
            await client.rpc('decrement_shop_balance', {
              p_shop_id: order.shop_id,
              p_amount: refundAmount,
            });
            await client.from('shop_transactions').insert({
              shop_id: order.shop_id,
              order_id: order.id,
              amount: -Math.abs(refundAmount),
              type: 'refund',
              status: 'completed',
              reference,
              metadata: { reason: 'payment_reversed' },
            });
          } catch (e: any) {
            await client.from('shop_transactions').insert({
              shop_id: order.shop_id,
              order_id: order.id,
              amount: -Math.abs(refundAmount),
              type: 'refund',
              status: 'failed',
              reference,
              metadata: { reason: 'payment_reversed', error: e.message },
            });
          }
        }

        const { data: shop } = await client
          .from('shops')
          .select('id, user_id')
          .eq('id', order.shop_id)
          .maybeSingle();

        if (shop?.user_id) {
          await client.from('notifications').insert([
            {
              user_id: shop.user_id,
              type: 'shop_payment_issue',
              title: 'Payment reversed',
              body: `Payment for order #${order.id.substring(0, 8).toUpperCase()} was reversed.`,
              data: { order_id: order.id },
              is_read: false,
            },
            {
              user_id: order.buyer_id,
              type: 'shop_payment_issue',
              title: 'Payment issue',
              body: `Your payment for order #${order.id.substring(0, 8).toUpperCase()} was reversed.`,
              data: { order_id: order.id },
              is_read: false,
            },
          ]);
        }
      }
    }
    await this.logAdminEvent({
      level: 'warn',
      category: 'payment',
      message: `Payment reversed ${reference}`,
      metadata: { reference, orderId: metadata.order_id, kind: metadata.kind },
    });
  }

  private async reconcileFailedPayments() {
    const client = this.supabase.getClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: failed } = await client
      .from('payment_intents')
      .select('reference, status')
      .in('status', ['failed', 'expired'])
      .gte('created_at', since)
      .limit(50);

    for (const p of failed || []) {
      const snippe = await this.checkPaymentStatusFromSnippe(p.reference);
      if (snippe?.status === 'completed') {
        await client
          .from('payment_intents')
          .update({ status: 'completed', updated_at: new Date().toISOString() })
          .eq('reference', p.reference);
        await this.handleCompletedPayment(p.reference, snippe);
        await this.logAdminEvent({
          category: 'reconcile',
          message: `Failed payment reconciled ${p.reference}`,
          metadata: { reference: p.reference },
        });
      }
    }
  }

  private async reconcileMissingCredits() {
    const client = this.supabase.getClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: completed } = await client
      .from('payment_intents')
      .select('reference, metadata, amount, currency, user_id')
      .eq('status', 'completed')
      .gte('created_at', since)
      .limit(50);

    for (const intent of completed || []) {
      const metadata = intent.metadata || {};
      if (metadata.kind === 'coin_topup') {
        const { data: tx } = await client
          .from('coin_transactions')
          .select('id')
          .eq('reference', intent.reference)
          .eq('type', 'deposit')
          .maybeSingle();
        if (!tx) {
          await this.handleCompletedPayment(intent.reference, intent);
          await this.logAdminEvent({
            category: 'reconcile',
            message: `Missing coin credit reconciled ${intent.reference}`,
            metadata: { reference: intent.reference },
          });
        }
      }
      if (metadata.order_id) {
        const { data: stx } = await client
          .from('shop_transactions')
          .select('id')
          .eq('reference', intent.reference)
          .eq('type', 'sale')
          .maybeSingle();
        if (!stx) {
          await this.handleCompletedPayment(intent.reference, intent);
          await this.logAdminEvent({
            category: 'reconcile',
            message: `Missing shop credit reconciled ${intent.reference}`,
            metadata: { reference: intent.reference },
          });
        }
      }
    }
  }

  private async _updateSoldCounts(orderId: string) {
    const client = this.supabase.getClient();
    const { data: items } = await client
      .from('order_items')
      .select('product_id, quantity')
      .eq('order_id', orderId);

    for (const item of items || []) {
      const productId = item.product_id;
      const qty = Number(item.quantity || 0);
      if (!productId || qty <= 0) continue;
      const { data: product } = await client
        .from('products')
        .select('sold_count')
        .eq('id', productId)
        .maybeSingle();
      const current = Number(product?.sold_count || 0);
      await client
        .from('products')
        .update({ sold_count: current + qty })
        .eq('id', productId);
    }
  }

  private async getOrderProductSummary(orderId: string) {
    const client = this.supabase.getClient();
    const { data: items } = await client
      .from('order_items')
      .select('quantity, product_id, products(name)')
      .eq('order_id', orderId);

    const summaryParts: string[] = [];
    for (const item of items || []) {
      const qty = Number(item.quantity || 0);
      const products = (item as any)?.products;
      const productName =
        (Array.isArray(products) ? products[0]?.name : products?.name) ||
        (item as any)?.product_id ||
        'Product';
      if (qty > 1) {
        summaryParts.push(`${productName} x${qty}`);
      } else {
        summaryParts.push(`${productName}`);
      }
    }
    return summaryParts.length ? summaryParts.join(', ') : undefined;
  }

  private async _notifyOrderPaid(
    order: { id: string; buyer_id: string; shop_id: string },
    shop: { id: string; shop_name?: string; user_id: string },
    amount: number,
    currency: string,
  ) {
    const client = this.supabase.getClient();
    const { data: buyer } = await client
      .from('users')
      .select('full_name, username')
      .eq('id', order.buyer_id)
      .maybeSingle();
    const buyerName = buyer?.full_name || buyer?.username || 'Customer';
    const productInfo = await this.getOrderPrimaryProductInfo(order.id);
    const productLabel = productInfo?.name ? ` for ${productInfo.name}` : '';

    await this.notifications.sendPushNotification({
      userId: shop.user_id,
      type: 'shop_order_paid',
      title: 'New order paid',
      body: `${buyerName} paid ${currency} ${amount.toFixed(0)}${productLabel}`,
      imageUrl: productInfo?.imageUrl,
      data: { order_id: order.id, shop_id: shop.id },
    });

    await this.notifications.sendPushNotification({
      userId: order.buyer_id,
      type: 'shop_order_paid',
      title: 'Payment received',
      body: `Payment confirmed${productLabel}.`,
      imageUrl: productInfo?.imageUrl,
      data: { order_id: order.id, shop_id: shop.id },
    });
  }

  private async getOrderPrimaryProductInfo(orderId: string) {
    const client = this.supabase.getClient();
    const { data: items } = await client
      .from('order_items')
      .select('products(name, thumbnail_url, image_url, image_urls)')
      .eq('order_id', orderId)
      .limit(1);

    const item: any = (items || [])[0];
    const product: any = item?.products || item?.products?.[0];
    if (!product) return undefined;
    const name = product.name as string | undefined;
    const imageUrl =
      (product.thumbnail_url as string | undefined) ||
      (product.image_url as string | undefined) ||
      (Array.isArray(product.image_urls) ? product.image_urls[0] : undefined);
    return { name, imageUrl };
  }

  private async sendShopPaymentEmail(input: {
    shopId: string;
    shopName?: string;
    ownerId: string;
    amount: number;
    currency: string;
    orderId: string;
    reference: string;
    productSummary?: string;
  }) {
    if (!this.smtpHost || !this.smtpUser || !this.smtpPass) {
      this.logger.debug('SMTP not configured, skipping shop payment email.');
      return;
    }

    const client = this.supabase.getClient();
    const { data: owner } = await client
      .from('users')
      .select('email, full_name, username')
      .eq('id', input.ownerId)
      .maybeSingle();

    if (!owner?.email) {
      this.logger.warn(`Shop owner email not found for shop ${input.shopId}`);
      return;
    }

    const transporter = nodemailer.createTransport({
      host: this.smtpHost,
      port: this.smtpPort,
      secure: this.smtpPort === 465,
      auth: {
        user: this.smtpUser,
        pass: this.smtpPass,
      },
    });

    const shopLabel = input.shopName || 'Your shop';
    const ownerName = owner.full_name || owner.username || 'Seller';
    const amountText = `${input.currency} ${input.amount.toFixed(0)}`;

    const subject = `New order payment received - ${shopLabel}`;
    const text = [
      `Hi ${ownerName},`,
      '',
      `You received a new payment for order ${input.orderId}.`,
      ...(input.productSummary ? [`Products: ${input.productSummary}`] : []),
      `Amount: ${amountText}`,
      `Payment reference: ${input.reference}`,
      '',
      'Log in to your WhapVibez dashboard to view the order details.',
      '',
      'Thanks,',
      'WhapVibez',
    ].join('\n');

    try {
      await transporter.sendMail({
        from: this.smtpFrom,
        to: owner.email,
        subject,
        text,
      });
      this.logger.log(`📧 Shop payment email sent to ${owner.email}`);
    } catch (e: any) {
      this.logger.error(`❌ Failed to send shop payment email: ${e.message}`);
    }
  }

  private async sendBuyerPaymentEmail(input: {
    buyerId: string;
    orderId: string;
    amount: number;
    currency: string;
    reference: string;
    productSummary?: string;
  }) {
    if (!this.smtpHost || !this.smtpUser || !this.smtpPass) {
      this.logger.debug('SMTP not configured, skipping buyer payment email.');
      return;
    }

    const client = this.supabase.getClient();
    const { data: buyer } = await client
      .from('users')
      .select('email, full_name, username')
      .eq('id', input.buyerId)
      .maybeSingle();

    if (!buyer?.email) {
      this.logger.warn(`Buyer email not found for order ${input.orderId}`);
      return;
    }

    const transporter = nodemailer.createTransport({
      host: this.smtpHost,
      port: this.smtpPort,
      secure: this.smtpPort === 465,
      auth: {
        user: this.smtpUser,
        pass: this.smtpPass,
      },
    });

    const buyerName = buyer.full_name || buyer.username || 'Customer';
    const amountText = `${input.currency} ${input.amount.toFixed(0)}`;

    const subject = 'Payment received for your order';
    const text = [
      `Hi ${buyerName},`,
      '',
      `We received your payment for order ${input.orderId}.`,
      ...(input.productSummary ? [`Products: ${input.productSummary}`] : []),
      `Amount: ${amountText}`,
      `Payment reference: ${input.reference}`,
      '',
      'You can track your order status in the app.',
      '',
      'Thanks,',
      'WhapVibez',
    ].join('\n');

    try {
      await transporter.sendMail({
        from: this.smtpFrom,
        to: buyer.email,
        subject,
        text,
      });
      this.logger.log(`📧 Buyer payment email sent to ${buyer.email}`);
    } catch (e: any) {
      this.logger.error(`❌ Failed to send buyer payment email: ${e.message}`);
    }
  }

  async getShopWalletSummary(userId: string) {
    const client = this.supabase.getClient();
    const { data: shop } = await client
      .from('shops')
      .select('id, shop_name')
      .eq('user_id', userId)
      .maybeSingle();

    if (!shop?.id) {
      return { hasShop: false };
    }

    const { data: wallet } = await client
      .from('shop_wallets')
      .select('balance')
      .eq('shop_id', shop.id)
      .maybeSingle();

    if (!wallet) {
      await client.from('shop_wallets').insert({ shop_id: shop.id, balance: 0 });
    }

    const [{ data: transactions }, { data: pendingOrders }] = await Promise.all([
      client
        .from('shop_transactions')
        .select('*')
        .eq('shop_id', shop.id)
        .order('created_at', { ascending: false })
        .limit(50),
      client
        .from('orders')
        .select('total_amount')
        .eq('shop_id', shop.id)
        .in('status', ['pending', 'processing', 'shipped']),
    ]);

    const txList = (transactions as any[]) || [];
    let totalIncome = 0;
    for (const tx of txList) {
      const amount = Number(tx.amount || 0);
      if (amount > 0) totalIncome += amount;
    }

    let pendingAmount = 0;
    for (const order of pendingOrders || []) {
      pendingAmount += Number(order.total_amount || 0);
    }

    const { data: finalWallet } = await client
      .from('shop_wallets')
      .select('balance')
      .eq('shop_id', shop.id)
      .maybeSingle();

    return {
      hasShop: true,
      shopId: shop.id,
      shopName: shop.shop_name,
      balance: Number(finalWallet?.balance || 0),
      totalIncome,
      pendingAmount,
      transactions: txList,
    };
  }

  /**
   * Auto-approve stale pending KYC submissions after configured SLA.
   * Default: 24 hours (1 business day).
   *
   * Controls:
   * - KYC_AUTO_APPROVE_ENABLED=true|false (default true)
   * - KYC_AUTO_APPROVE_HOURS=24 (default 24)
   */
  @Cron('0 */15 * * * *') // every 15 minutes
  async autoApproveStaleKycSubmissions() {
    const enabled = (
      this.config.get<string>('KYC_AUTO_APPROVE_ENABLED', 'true') || 'true'
    )
      .toLowerCase()
      .trim();
    if (enabled === 'false' || enabled === '0' || enabled === 'no') {
      return;
    }

    const hoursCfg = Number(this.config.get<string>('KYC_AUTO_APPROVE_HOURS', '24'));
    const hours = Number.isFinite(hoursCfg) && hoursCfg > 0 ? hoursCfg : 24;
    const cutoffIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();
    const client = this.supabase.getClient();

    try {
      const { data: stalePending, error } = await client
        .from('user_kyc_submissions')
        .select('id, user_id, created_at')
        .eq('status', 'pending')
        .lte('created_at', cutoffIso)
        .limit(100);

      if (error) {
        this.logger.warn(`Auto-approve KYC fetch failed: ${error.message}`);
        return;
      }

      if (!stalePending || stalePending.length === 0) {
        return;
      }

      let approvedCount = 0;
      for (const row of stalePending) {
        const { data: updated, error: updateError } = await client
          .from('user_kyc_submissions')
          .update({ status: 'approved', reviewed_at: nowIso })
          .eq('id', row.id)
          .eq('status', 'pending')
          .select('id, user_id')
          .maybeSingle();

        if (updateError) {
          this.logger.warn(
            `Auto-approve KYC update failed (${row.id}): ${updateError.message}`,
          );
          continue;
        }
        if (!updated?.id || !updated.user_id) {
          continue;
        }

        approvedCount++;
        await this.syncUserVerificationFlag(updated.user_id);
        await this.sendVerificationApprovalEmail(updated.user_id);
      }

      if (approvedCount > 0) {
        this.logger.log(
          `✅ Auto-approved ${approvedCount} stale KYC submission(s) older than ${hours}h`,
        );
        await this.logAdminEvent({
          category: 'verification',
          message: 'autoApproveStaleKycSubmissions',
          metadata: { approvedCount, hours, cutoffIso },
        });
      }
    } catch (e: any) {
      this.logger.warn(`Auto-approve stale KYC failed: ${e?.message || e}`);
    }
  }

  private async postToSnippe(payload: Record<string, any>, idempotencyKey: string): Promise<SnippeResponse> {
    const url = `${this.apiUrl}/payments`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    const raw = await res.text();
    let json: any = null;
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      json = { message: raw || 'Invalid response from payment provider' };
    }

    if (!res.ok) {
      this.logger.warn('Snippe payment error', {
        status: res.status,
        response: json,
        paymentType: payload.payment_type,
        hasRedirectUrl: !!payload?.details?.redirect_url,
        hasCallbackUrl: !!payload?.details?.callback_url,
        hasPhoneNumber: !!payload?.phone_number,
        metadataKind: payload?.metadata?.kind,
      });
      throw new BadRequestException(
        json?.message || json?.error || json?.detail || 'Payment creation failed',
      );
    }
    return json as SnippeResponse;
  }

  /** Normalize Tanzania phone to E.164 (255...) for Snippe. */
  private normalizePhoneForPayout(phone: string): string {
    let digits = (phone || '').replace(/\D/g, '');
    if (digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length === 9) return '255' + digits;
    if (digits.length === 12 && digits.startsWith('255')) return digits;
    return phone;
  }

  private async postToSnippePayout(payload: Record<string, any>, idempotencyKey: string): Promise<any> {
    const url = `${this.apiUrl}/payouts/send`;
    this.logger.log(`Payout request: amount=${payload.amount} channel=${payload.channel} recipient_phone=${payload.recipient_phone?.replace(/\d(?=\d{4})/g, '*')}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    if (!res.ok) {
      this.logger.warn(`Snippe payout error ${res.status}: ${JSON.stringify(json)}`);
      throw new BadRequestException(json?.message || json?.error || 'Payout creation failed');
    }
    return json;
  }

  private async storeIntent(data: {
    userId: string;
    reference: string;
    status: string;
    amount: number;
    currency: string;
    paymentType: string;
    paymentUrl?: string;
    expiresAt?: string;
    idempotencyKey: string;
    phoneNumber?: string;
    metadata?: Record<string, any>;
  }) {
    const client = this.supabase.getClient();
    const { error } = await client.from('payment_intents').insert({
      user_id: data.userId,
      reference: data.reference,
      status: data.status,
      amount: data.amount,
      currency: data.currency,
      payment_type: data.paymentType,
      payment_url: data.paymentUrl,
      expires_at: data.expiresAt,
      idempotency_key: data.idempotencyKey,
      phone_number: data.phoneNumber,
      metadata: data.metadata || {},
    });
    
    if (error) {
      this.logger.error(`❌ Error storing payment intent: ${data.reference}`, {
        error: error.message,
        code: error.code,
        details: error.details,
      });
      throw error;
    }
  }

  private async syncFirestoreWallet(userId: string, balance: number) {
    try {
      const firestore = this.firebase.getFirestore();
      await firestore.collection('user_wallets').doc(userId).set(
        {
          coins: balance,
          updatedAt: new Date(),
        },
        { merge: true },
      );
    } catch (e) {
      // Firebase may not be configured; ignore to avoid failing payments
    }
  }
}
