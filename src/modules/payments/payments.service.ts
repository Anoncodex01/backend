import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { v4 as uuidv4 } from 'uuid';
import * as nodemailer from 'nodemailer';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { FirebaseService } from '../../core/firebase/firebase.service';
import { CreateMobilePaymentDto } from './dto/create-mobile-payment.dto';
import { CreateCardPaymentDto } from './dto/create-card-payment.dto';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { CreateGiftTransferDto } from './dto/create-gift-transfer.dto';

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

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private config: ConfigService,
    private supabase: SupabaseService,
    private firebase: FirebaseService,
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

  private get coinRate() {
    return Number(this.config.get<string>('COIN_RATE', '1'));
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

    const payload = {
      payment_type: 'card',
      details: {
        amount: dto.amount,
        currency: dto.currency,
        redirect_url: dto.redirectUrl,
      },
      phone_number: dto.phoneNumber,
      customer: {
        firstname: dto.customerFirstName,
        lastname: dto.customerLastName,
        email: dto.customerEmail,
        address: dto.customerAddress,
        city: dto.customerCity,
        state: dto.customerState,
        postcode: dto.customerPostcode,
        country: dto.customerCountry,
      },
      webhook_url: this.webhookUrl || undefined,
      metadata,
    };

    const response = await this.postToSnippe(payload, idempotencyKey);
    
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

    const newStatus = snippePayment.status;
    
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
   * Manually trigger payment status check for a specific reference
   */
  async manualCheckPaymentStatus(reference: string) {
    return this.checkAndUpdatePaymentStatus(reference);
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
    try {
      const { data: newBalance, error } = await client.rpc('decrement_coin_balance', {
        p_user_id: userId,
        p_amount: dto.amount,
      });
      if (error) {
        throw error;
      }

      await client.from('withdrawal_requests').insert({
        user_id: userId,
        amount: dto.amount,
        currency: dto.currency,
        method: dto.method,
        account: dto.account,
        status: 'pending',
        metadata: dto.metadata || {},
      });

      await client.from('coin_transactions').insert({
        user_id: userId,
        amount: -Math.abs(dto.amount),
        type: 'withdraw',
        status: 'pending',
        metadata: dto.metadata || {},
      });

      if (typeof newBalance === 'number') {
        await this.syncFirestoreWallet(userId, newBalance);
      }

      return { success: true };
    } catch (e: any) {
      if ((e?.message || '').includes('insufficient_balance')) {
        throw new BadRequestException('Not enough coins');
      }
      throw new BadRequestException('Unable to create withdrawal');
    }
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

  async sendGift(senderId: string, dto: CreateGiftTransferDto) {
    if (senderId === dto.receiverId) {
      throw new BadRequestException('Cannot send gift to yourself');
    }
    const client = this.supabase.getClient();
    try {
      const { data: senderBalance, error } = await client.rpc('decrement_coin_balance', {
        p_user_id: senderId,
        p_amount: dto.coinCost,
      });
      if (error) {
        throw error;
      }

      const { data: receiverBalance } = await client.rpc('increment_coin_balance', {
        p_user_id: dto.receiverId,
        p_amount: dto.coinCost,
      });

      const metadata = {
        giftName: dto.giftName,
        giftIcon: dto.giftIcon,
        liveId: dto.liveId,
        receiverId: dto.receiverId,
        senderId,
      };

      await client.from('coin_transactions').insert([
        {
          user_id: senderId,
          amount: -Math.abs(dto.coinCost),
          type: 'gift',
          status: 'completed',
          metadata: { ...metadata, direction: 'sent' },
        },
        {
          user_id: dto.receiverId,
          amount: Math.abs(dto.coinCost),
          type: 'gift',
          status: 'completed',
          metadata: { ...metadata, direction: 'received' },
        },
      ]);

      if (typeof senderBalance === 'number') {
        await this.syncFirestoreWallet(senderId, senderBalance);
      }
      if (typeof receiverBalance === 'number') {
        await this.syncFirestoreWallet(dto.receiverId, receiverBalance);
      }

      return {
        senderBalance,
        receiverBalance,
      };
    } catch (e: any) {
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
      const eventType = body.type || headers['x-webhook-event'] || headers['X-Webhook-Event'];
      const webhookData = body.data || body;
      
      const reference = webhookData.reference;
      const status = webhookData.status || (eventType === 'payment.completed' ? 'completed' : eventType === 'payment.failed' ? 'failed' : 'unknown');

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

      // Update payment intent status
      const client = this.supabase.getClient();
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
      } else if (eventType === 'payment.failed' || status === 'failed') {
        this.logger.log(`❌ Payment failed for reference: ${reference}`, {
          failureReason: webhookData.failure_reason,
        });
        // Optionally handle failed payments (notify user, etc.)
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
        .update({ status: 'processing', updated_at: new Date().toISOString() })
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

      // Calculate coins based on payment amount and coin rate
      // Handle both old format (payload.amount) and new format (payload.amount.value)
      const paymentAmount = Number(
        payload.amount?.value || 
        payload.amount || 
        finalIntent.amount || 
        0
      );
      const coins = Math.floor(paymentAmount * this.coinRate);
      
      this.logger.log(`💰 Converting payment to coins:`, {
        paymentAmount,
        coinRate: this.coinRate,
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

      // Sync to Firestore if available
      if (typeof newBalance === 'number') {
        await this.syncFirestoreWallet(userId, newBalance);
        this.logger.log(`✅ Firestore wallet synced for user ${userId}`);
      }
    } else {
      this.logger.log(`ℹ️  Payment kind is not coin_topup, skipping coin processing:`, metadata.kind);
    }
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

    await this.sendShopPaymentEmail({
      shopId: shop.id,
      shopName: shop.shop_name,
      ownerId: shop.user_id,
      amount,
      currency,
      orderId: order.id,
      reference,
    });

    await this.sendBuyerPaymentEmail({
      buyerId: order.buyer_id,
      orderId: order.id,
      amount,
      currency,
      reference,
    });
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

    await client.from('notifications').insert([
      {
        user_id: shop.user_id,
        type: 'shop_order_paid',
        title: 'New order paid',
        body: `${buyerName} paid ${currency} ${amount.toFixed(0)} for order #${order.id.substring(0, 8).toUpperCase()}`,
        data: { order_id: order.id, shop_id: shop.id },
        is_read: false,
      },
      {
        user_id: order.buyer_id,
        type: 'shop_order_paid',
        title: 'Payment received',
        body: `Payment confirmed for your order #${order.id.substring(0, 8).toUpperCase()}.`,
        data: { order_id: order.id, shop_id: shop.id },
        is_read: false,
      },
    ]);
  }

  private async sendShopPaymentEmail(input: {
    shopId: string;
    shopName?: string;
    ownerId: string;
    amount: number;
    currency: string;
    orderId: string;
    reference: string;
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

    const json = await res.json();
    if (!res.ok) {
      throw new BadRequestException(json?.message || 'Payment creation failed');
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
