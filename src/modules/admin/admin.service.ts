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
      ordersCount,
      recentOrders,
      recentWithdrawals,
      recentLogs,
      cronLogs,
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
      client.from('orders').select('id', { count: 'exact', head: true }),
      client
        .from('orders')
        .select('id,status,total_amount,created_at')
        .order('created_at', { ascending: false })
        .limit(10),
      client
        .from('withdrawals')
        .select('id,status,amount,created_at')
        .order('created_at', { ascending: false })
        .limit(10),
      client
        .from('admin_logs')
        .select('level,category,message,created_at')
        .order('created_at', { ascending: false })
        .limit(30),
      client
        .from('admin_logs')
        .select('level,category,message,created_at')
        .eq('category', 'cron')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    const cronStatusMap = new Map<string, any>();
    for (const log of cronLogs.data || []) {
      if (!cronStatusMap.has(log.message)) {
        cronStatusMap.set(log.message, log);
      }
    }

    return {
      usersCount: usersCount.count || 0,
      walletsCount: walletsCount.count || 0,
      pendingPayments: pendingPayments.count || 0,
      completedPayments: completedPayments.count || 0,
      failedPayments: failedPayments.count || 0,
      pendingWithdrawals: pendingWithdrawals.count || 0,
      recentPayments: recentPayments.data || [],
      recentGifts: recentGifts.data || [],
      ordersCount: ordersCount.count || 0,
      recentOrders: recentOrders.data || [],
      recentWithdrawals: recentWithdrawals.data || [],
      recentLogs: recentLogs.data || [],
      cronJobs: Array.from(cronStatusMap.values()),
    };
  }
}
