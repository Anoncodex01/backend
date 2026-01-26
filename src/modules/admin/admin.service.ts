import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../core/supabase/supabase.service';

@Injectable()
export class AdminService {
  constructor(private readonly supabase: SupabaseService) {}

  async getDashboard() {
    const client = this.supabase.getClient();

    const [
      usersCount,
      walletsCount,
      pendingPayments,
      completedPayments,
      failedPayments,
      pendingWithdrawals,
      recentPayments,
      recentGifts,
    ] = await Promise.all([
      client.from('users').select('id', { count: 'exact', head: true }),
      client.from('coin_wallets').select('id', { count: 'exact', head: true }),
      client.from('payment_intents').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      client.from('payment_intents').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
      client.from('payment_intents').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
      client.from('withdrawal_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      client
        .from('payment_intents')
        .select('reference,status,amount,currency,payment_type,created_at')
        .order('created_at', { ascending: false })
        .limit(10),
      client
        .from('coin_transactions')
        .select('user_id,amount,metadata,created_at')
        .eq('type', 'gift')
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    return {
      usersCount: usersCount.count || 0,
      walletsCount: walletsCount.count || 0,
      pendingPayments: pendingPayments.count || 0,
      completedPayments: completedPayments.count || 0,
      failedPayments: failedPayments.count || 0,
      pendingWithdrawals: pendingWithdrawals.count || 0,
      recentPayments: recentPayments.data || [],
      recentGifts: recentGifts.data || [],
    };
  }
}
