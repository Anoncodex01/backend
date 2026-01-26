import { Controller, Get, Post, Res, Req } from '@nestjs/common';
import { AdminService } from './admin.service';
import { Response, Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('login')
  loginPage(@Res() res: Response) {
    return res.send(this.renderLogin());
  }

  @Post('login')
  async login(@Req() req: Request, @Res() res: Response) {
    const { email, password } = req.body || {};
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const secret = process.env.ADMIN_SECRET || 'admin_secret';

    if (!adminEmail || !adminPassword) {
      return res.status(500).send('Admin credentials not configured.');
    }

    const valid =
      typeof email === 'string' &&
      typeof password === 'string' &&
      email === adminEmail &&
      password === adminPassword;

    if (!valid) {
      return res.status(401).send(this.renderLogin('Invalid credentials'));
    }

    const payload = Buffer.from(JSON.stringify({ email, iat: Date.now() })).toString('base64url');
    const signature = createHmac('sha256', secret).update(payload).digest('base64url');
    const token = `${payload}.${signature}`;

    res.cookie('admin_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24,
      path: '/',
    });
    return res.redirect(this.prefixPath('/admin'));
  }

  @Get('logout')
  logout(@Res() res: Response) {
    res.clearCookie('admin_session', { path: '/' });
    return res.redirect(this.prefixPath('/admin/login'));
  }

  @Get()
  async dashboard(@Req() req: Request, @Res() res: Response) {
    if (!this.isAuthed(req)) {
      return res.redirect(this.prefixPath('/admin/login'));
    }
    const data = await this.adminService.getDashboard();
    return res.send(this.renderDashboard(data));
  }

  private isAuthed(req: Request) {
    const secret = process.env.ADMIN_SECRET || 'admin_secret';
    const token = this.getCookie(req, 'admin_session');
    if (!token) return false;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return false;
    const expected = createHmac('sha256', secret).update(payload).digest('base64url');
    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  private getCookie(req: Request, name: string) {
    const header = req.headers.cookie;
    if (!header) return null;
    const parts = header.split(';').map((c) => c.trim());
    for (const part of parts) {
      const [key, ...rest] = part.split('=');
      if (key === name) return rest.join('=');
    }
    return null;
  }

  private renderLogin(error?: string) {
    const loginAction = this.prefixPath('/admin/login');
    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Admin Login</title>
          <style>
            body { font-family: Inter, Arial, sans-serif; background:#0b1220; color:#fff; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
            .card { background:#121a2b; padding:28px; border-radius:16px; width:360px; box-shadow:0 18px 50px rgba(0,0,0,.35); }
            h1 { font-size:20px; margin:0 0 16px; }
            input { width:100%; padding:12px; margin:8px 0; border-radius:10px; border:1px solid #26314d; background:#0f1626; color:#fff; }
            button { width:100%; padding:12px; border-radius:12px; border:none; background:#3b82f6; color:#fff; font-weight:700; margin-top:10px; }
            .error { color:#f87171; font-size:12px; margin-top:6px; }
          </style>
        </head>
        <body>
          <form class="card" method="post" action="${loginAction}">
            <h1>Admin Login</h1>
            <input name="email" type="email" placeholder="Email" required />
            <input name="password" type="password" placeholder="Password" required />
            <button type="submit">Login</button>
            ${error ? `<div class="error">${error}</div>` : ''}
          </form>
        </body>
      </html>
    `;
  }

  private renderDashboard(data: any) {
    const logoutUrl = this.prefixPath('/admin/logout');
    const card = (title: string, value: string | number) => `
      <div class="card">
        <div class="label">${title}</div>
        <div class="value">${value}</div>
      </div>
    `;
    const rows = (data.recentPayments || [])
      .map(
        (p: any) => `
        <tr>
          <td>${p.reference || '-'}</td>
          <td>${p.status || '-'}</td>
          <td>${p.amount || 0} ${p.currency || ''}</td>
          <td>${p.payment_type || '-'}</td>
          <td>${p.created_at || '-'}</td>
        </tr>
      `,
      )
      .join('');

    const gifts = (data.recentGifts || [])
      .map(
        (g: any) => `
        <tr>
          <td>${g.user_id || '-'}</td>
          <td>${g.amount || 0}</td>
          <td>${g.metadata?.giftName || '-'}</td>
          <td>${g.created_at || '-'}</td>
        </tr>
      `,
      )
      .join('');

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Admin Dashboard</title>
          <style>
            body { font-family: Inter, Arial, sans-serif; background:#0b1220; color:#e5e7eb; margin:0; }
            header { display:flex; justify-content:space-between; align-items:center; padding:20px 28px; }
            .logout { color:#93c5fd; text-decoration:none; }
            .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(160px,1fr)); gap:14px; padding:0 28px 20px; }
            .card { background:#121a2b; padding:16px; border-radius:14px; box-shadow:0 10px 30px rgba(0,0,0,.25); }
            .label { font-size:12px; color:#94a3b8; }
            .value { font-size:22px; font-weight:700; margin-top:6px; }
            h2 { margin:16px 28px 8px; font-size:16px; }
            table { width: calc(100% - 56px); margin:0 28px 24px; border-collapse:collapse; background:#111827; border-radius:12px; overflow:hidden; }
            th, td { padding:10px 12px; border-bottom:1px solid #1f2937; font-size:12px; text-align:left; }
            th { color:#94a3b8; font-weight:600; }
          </style>
        </head>
        <body>
          <header>
            <h1>Admin Dashboard</h1>
            <a class="logout" href="${logoutUrl}">Logout</a>
          </header>
          <section class="grid">
            ${card('Users', data.usersCount)}
            ${card('Wallets', data.walletsCount)}
            ${card('Payments Pending', data.pendingPayments)}
            ${card('Payments Completed', data.completedPayments)}
            ${card('Payments Failed', data.failedPayments)}
            ${card('Withdrawals Pending', data.pendingWithdrawals)}
          </section>
          <h2>Recent Payments</h2>
          <table>
            <thead>
              <tr><th>Reference</th><th>Status</th><th>Amount</th><th>Type</th><th>Created</th></tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="5">No payments</td></tr>'}</tbody>
          </table>
          <h2>Recent Gifts</h2>
          <table>
            <thead>
              <tr><th>User</th><th>Coins</th><th>Gift</th><th>Created</th></tr>
            </thead>
            <tbody>${gifts || '<tr><td colspan="4">No gifts</td></tr>'}</tbody>
          </table>
        </body>
      </html>
    `;
  }

  private prefixPath(path: string) {
    const prefix = process.env.API_PREFIX || 'v1';
    return `/${prefix}${path}`;
  }
}
