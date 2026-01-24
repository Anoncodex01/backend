import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
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

  private get webhookSecret() {
    return this.config.get<string>('SNIPPE_WEBHOOK_SECRET', '');
  }

  private get coinRate() {
    return Number(this.config.get<string>('COIN_RATE', '1'));
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
    await this.storeIntent({
      userId,
      reference: response.data.reference,
      status: response.data.status,
      amount: response.data.amount,
      currency: response.data.currency,
      paymentType: response.data.payment_type,
      paymentUrl: response.data.payment_url,
      expiresAt: response.data.expires_at,
      idempotencyKey,
      phoneNumber: dto.phoneNumber,
      metadata,
    });

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
    await this.storeIntent({
      userId,
      reference: response.data.reference,
      status: response.data.status,
      amount: response.data.amount,
      currency: response.data.currency,
      paymentType: response.data.payment_type,
      paymentUrl: response.data.payment_url,
      expiresAt: response.data.expires_at,
      idempotencyKey,
      phoneNumber: dto.phoneNumber,
      metadata,
    });

    return response;
  }

  async getPaymentStatus(reference: string) {
    const url = `${this.apiUrl}/payments/${reference}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new BadRequestException(text || 'Failed to fetch payment status');
    }
    return res.json();
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
    console.log('🔔 Webhook received:', {
      hasBody: !!rawBody,
      bodyType: typeof rawBody,
      headers: Object.keys(headers),
      signatureHeader: headers['x-webhook-signature'] || headers['X-Webhook-Signature'] || 'none',
    });

    try {
      const signature = (headers['x-webhook-signature'] || headers['X-Webhook-Signature']) as string;
      
      // Only verify signature if webhook secret is properly configured (not placeholder)
      if (this.webhookSecret && this.webhookSecret !== 'YOUR_WEBHOOK_SECRET' && signature) {
        const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
        const computed = createHmac('sha256', this.webhookSecret).update(payload).digest('hex');
        const valid = timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
        if (!valid) {
          console.error('❌ Invalid webhook signature');
          throw new ForbiddenException('Invalid webhook signature');
        }
        console.log('✅ Webhook signature verified');
      } else {
        console.log('⚠️  Webhook signature verification skipped (secret not configured or no signature)');
      }

      const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));
      const reference = body.reference;
      const status = body.status;

      console.log('📦 Webhook payload:', {
        reference,
        status,
        metadata: body.metadata,
        amount: body.amount,
      });

      if (!reference) {
        console.error('❌ Webhook missing reference');
        throw new BadRequestException('Missing payment reference');
      }

      const client = this.supabase.getClient();
      const updateResult = await client
        .from('payment_intents')
        .update({
          status,
          updated_at: new Date().toISOString(),
        })
        .eq('reference', reference)
        .select();

      console.log(`✅ Updated payment intent ${reference} to status: ${status}`, {
        rowsUpdated: updateResult.data?.length || 0,
      });

      if (status === 'completed') {
        console.log(`💰 Processing completed payment for reference: ${reference}`);
        await this.handleCompletedPayment(reference, body);
        console.log(`✅ Completed payment processed successfully for reference: ${reference}`);
      }

      return { received: true, reference, status };
    } catch (error: any) {
      console.error('❌ Webhook processing error:', {
        error: error.message,
        stack: error.stack,
        reference: (typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8')))?.reference,
      });
      throw error;
    }
  }

  private async handleCompletedPayment(reference: string, payload: any) {
    console.log(`🔄 Processing completed payment for reference: ${reference}`);
    const client = this.supabase.getClient();
    const { data: intent, error: intentError } = await client
      .from('payment_intents')
      .select('user_id, amount, currency, metadata')
      .eq('reference', reference)
      .maybeSingle();

    if (intentError) {
      console.error('❌ Error fetching payment intent:', intentError);
      throw new BadRequestException('Payment intent not found');
    }

    if (!intent) {
      console.error('❌ Payment intent not found for reference:', reference);
      throw new BadRequestException('Payment intent not found');
    }

    const metadata = payload.metadata || intent?.metadata || {};
    const userId = metadata.user_id || intent?.user_id;
    
    if (!userId) {
      console.error('❌ No user_id found in payment intent or metadata:', { reference, metadata, intent });
      return;
    }

    console.log(`👤 Processing payment for user: ${userId}`, {
      amount: intent.amount,
      currency: intent.currency,
      metadata,
    });

    if (metadata.order_id) {
      await client
        .from('orders')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('id', metadata.order_id);
      console.log(`✅ Updated order ${metadata.order_id} to paid`);
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
        console.log(`⚠️  Transaction already processed for reference: ${reference}`);
        return;
      }

      // Calculate coins based on payment amount and coin rate
      const paymentAmount = Number(intent?.amount || payload.amount?.value || payload.amount || 0);
      const coins = Math.floor(paymentAmount * this.coinRate);
      
      console.log(`💰 Converting payment to coins:`, {
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
        console.error('❌ Error incrementing coin balance:', balanceError);
        throw new BadRequestException('Failed to update coin balance');
      }

      console.log(`✅ Coin balance updated for user ${userId}:`, {
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
        console.error('❌ Error creating coin transaction:', txError);
        throw new BadRequestException('Failed to create transaction record');
      }

      console.log(`✅ Coin transaction created for user ${userId}`);

      // Sync to Firestore if available
      if (typeof newBalance === 'number') {
        await this.syncFirestoreWallet(userId, newBalance);
        console.log(`✅ Firestore wallet synced for user ${userId}`);
      }
    } else {
      console.log(`ℹ️  Payment kind is not coin_topup, skipping coin processing:`, metadata.kind);
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
    await client.from('payment_intents').insert({
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
