import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { randomBytes } from 'crypto';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { UpdateSupportTicketDto } from './dto/update-support-ticket.dto';
import { AdminReplyTicketDto } from './dto/admin-reply-ticket.dto';
import { InboundEmailDto } from './dto/inbound-email.dto';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  private get client() {
    return this.supabaseService.getClient();
  }

  private get smtpHost() {
    return this.configService.get<string>('SMTP_HOST', '');
  }

  private get smtpPort() {
    return parseInt(this.configService.get<string>('SMTP_PORT', '465') || '465', 10);
  }

  private get smtpUser() {
    return this.configService.get<string>('SMTP_USER', '');
  }

  private get smtpPass() {
    return this.configService.get<string>('SMTP_PASSWORD') || this.configService.get<string>('SMTP_PASS') || '';
  }

  private get smtpFrom() {
    return this.configService.get<string>('SMTP_FROM_EMAIL') || this.configService.get<string>('SMTP_FROM') || this.smtpUser;
  }

  private get smtpFromName() {
    return this.configService.get<string>('SMTP_FROM_NAME', 'WhapVibez Support');
  }

  private get supportAdminSecret() {
    return (
      this.configService.get<string>('SUPPORT_ADMIN_SECRET', '') ||
      this.configService.get<string>('ADMIN_SECRET', '')
    );
  }

  private get supportInboundSecret() {
    return this.configService.get<string>('SUPPORT_INBOUND_SECRET', '');
  }

  private get supportPortalBaseUrl() {
    return this.configService.get<string>('SUPPORT_PORTAL_URL', 'https://support.whapvibez.com');
  }

  private assertAdminSecret(secret?: string) {
    if (!this.supportAdminSecret || secret !== this.supportAdminSecret) {
      throw new ForbiddenException('Invalid support admin secret');
    }
  }

  private assertInboundSecret(secret?: string) {
    if (!this.supportInboundSecret || secret !== this.supportInboundSecret) {
      throw new ForbiddenException('Invalid inbound support secret');
    }
  }

  private escapeHtml(input: string) {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private markdownToPlain(markdown: string) {
    return markdown
      .replace(/^#\s+/gm, '')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/`/g, '')
      .trim();
  }

  private async createTransporter() {
    if (!this.smtpHost || !this.smtpUser || !this.smtpPass) return null;
    return nodemailer.createTransport({
      host: this.smtpHost,
      port: this.smtpPort,
      secure: this.smtpPort === 465,
      auth: {
        user: this.smtpUser,
        pass: this.smtpPass,
      },
    });
  }

  private generateTicketNumber() {
    const now = new Date();
    const yyyy = now.getUTCFullYear().toString();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const suffix = randomBytes(3).toString('hex').toUpperCase();
    return `WV-${yyyy}${mm}${dd}-${suffix}`;
  }

  private generatePublicToken() {
    return randomBytes(18).toString('hex');
  }

  async listCategories() {
    const { data, error } = await this.client
      .from('support_categories')
      .select('id, slug, name, description, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) throw new InternalServerErrorException(error.message);
    return data || [];
  }

  async listArticles(search?: string, category?: string) {
    let query = this.client
      .from('support_articles')
      .select(`id, slug, title, summary, keywords, sort_order, category:support_categories(id, slug, name)`)
      .eq('is_published', true)
      .order('sort_order', { ascending: true });

    if (category) {
      const { data: categoryRow } = await this.client
        .from('support_categories')
        .select('id')
        .eq('slug', category)
        .maybeSingle();
      if (categoryRow?.id) {
        query = query.eq('category_id', categoryRow.id);
      }
    }

    if (search?.trim()) {
      const safe = search.trim().replace(/[%_]/g, '');
      query = query.or(`title.ilike.%${safe}%,summary.ilike.%${safe}%`);
    }

    const { data, error } = await query;
    if (error) throw new InternalServerErrorException(error.message);
    return data || [];
  }

  async getArticle(slug: string) {
    const { data, error } = await this.client
      .from('support_articles')
      .select(`id, slug, title, summary, content_markdown, keywords, category:support_categories(id, slug, name)`)
      .eq('slug', slug)
      .eq('is_published', true)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Article not found');
    return data;
  }

  async createTicket(dto: CreateSupportTicketDto) {
    const now = new Date().toISOString();
    const ticketNumber = this.generateTicketNumber();
    const publicToken = this.generatePublicToken();

    const ticketPayload = {
      ticket_number: ticketNumber,
      public_token: publicToken,
      requester_name: dto.requesterName.trim(),
      requester_email: dto.requesterEmail.trim().toLowerCase(),
      subject: dto.subject.trim(),
      description: dto.description.trim(),
      category_slug: dto.categorySlug?.trim() || null,
      source: dto.source || 'web',
      priority: dto.priority || 'medium',
      status: 'open',
      last_message_at: now,
      metadata: {},
      created_at: now,
      updated_at: now,
    };

    const { data: ticket, error } = await this.client
      .from('support_tickets')
      .insert(ticketPayload)
      .select('*')
      .single();

    if (error) {
      this.logger.error(`Failed to create support ticket: ${error.message}`);
      throw new InternalServerErrorException('Failed to create ticket');
    }

    const { error: msgError } = await this.client.from('support_ticket_messages').insert({
      ticket_id: ticket.id,
      sender_type: 'customer',
      sender_name: ticket.requester_name,
      sender_email: ticket.requester_email,
      channel: dto.source === 'app' ? 'portal' : dto.source === 'email' ? 'email' : 'portal',
      body_text: dto.description.trim(),
      body_html: `<p>${this.escapeHtml(dto.description.trim()).replace(/\n/g, '<br/>')}</p>`,
      is_internal: false,
      created_at: now,
    });

    if (msgError) {
      this.logger.warn(`Failed to insert initial support message: ${msgError.message}`);
    }

    await this.sendTicketCreatedEmail(ticket).catch((emailError) => {
      this.logger.warn(`Support ticket confirmation email skipped: ${emailError instanceof Error ? emailError.message : emailError}`);
    });

    return {
      success: true,
      ticketId: ticket.id,
      ticketNumber: ticket.ticket_number,
      publicToken: ticket.public_token,
      status: ticket.status,
      message: 'Support ticket created successfully',
    };
  }

  async listAdminTickets(secret: string, params: Record<string, any>) {
    this.assertAdminSecret(secret);

    const page = Math.max(parseInt(String(params.page || '1'), 10), 1);
    const limit = Math.min(Math.max(parseInt(String(params.limit || '25'), 10), 1), 100);
    const offset = (page - 1) * limit;
    const status = String(params.status || '').trim();
    const priority = String(params.priority || '').trim();
    const search = String(params.search || '').trim();

    let query = this.client
      .from('support_tickets')
      .select('*', { count: 'exact' })
      .order('last_message_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    if (search) {
      const safe = search.replace(/[%_]/g, '');
      query = query.or(`ticket_number.ilike.%${safe}%,requester_email.ilike.%${safe}%,requester_name.ilike.%${safe}%,subject.ilike.%${safe}%`);
    }

    const { data, error, count } = await query;
    if (error) throw new InternalServerErrorException(error.message);

    const statsQueries = await Promise.all([
      this.client.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      this.client.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'pending_customer'),
      this.client.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'pending_support'),
      this.client.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'resolved'),
      this.client.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'closed'),
      this.client.from('support_tickets').select('id', { count: 'exact', head: true }).eq('priority', 'high'),
      this.client.from('support_tickets').select('id', { count: 'exact', head: true }).eq('priority', 'urgent'),
    ]);

    return {
      data: data || [],
      meta: {
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
      },
      stats: {
        open: statsQueries[0].count || 0,
        pending_customer: statsQueries[1].count || 0,
        pending_support: statsQueries[2].count || 0,
        resolved: statsQueries[3].count || 0,
        closed: statsQueries[4].count || 0,
        high: statsQueries[5].count || 0,
        urgent: statsQueries[6].count || 0,
      },
    };
  }

  async getAdminTicket(secret: string, ticketId: string) {
    this.assertAdminSecret(secret);

    const { data: ticket, error } = await this.client
      .from('support_tickets')
      .select('*')
      .eq('id', ticketId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!ticket) throw new NotFoundException('Ticket not found');

    const { data: messages, error: messagesError } = await this.client
      .from('support_ticket_messages')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });

    if (messagesError) throw new InternalServerErrorException(messagesError.message);

    return { ticket, messages: messages || [] };
  }

  async updateAdminTicket(secret: string, ticketId: string, dto: UpdateSupportTicketDto) {
    this.assertAdminSecret(secret);

    const now = new Date().toISOString();
    const payload: Record<string, any> = { updated_at: now };
    if (dto.status) {
      payload.status = dto.status;
      payload.closed_at = dto.status === 'closed' ? now : null;
    }
    if (dto.priority) payload.priority = dto.priority;
    if (dto.assignedTo !== undefined) payload.assigned_to = dto.assignedTo || null;
    if (dto.assignedEmail !== undefined) payload.assigned_email = dto.assignedEmail || null;
    if (dto.tags !== undefined) payload.tags = dto.tags;

    const { error } = await this.client.from('support_tickets').update(payload).eq('id', ticketId);
    if (error) throw new InternalServerErrorException(error.message);
    return { success: true };
  }

  async replyToTicket(secret: string, ticketId: string, dto: AdminReplyTicketDto) {
    this.assertAdminSecret(secret);

    const { data: ticket, error } = await this.client
      .from('support_tickets')
      .select('*')
      .eq('id', ticketId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!ticket) throw new NotFoundException('Ticket not found');

    const now = new Date().toISOString();
    const bodyText = dto.bodyText.trim();
    const bodyHtml = dto.bodyHtml?.trim() || `<p>${this.escapeHtml(bodyText).replace(/\n/g, '<br/>')}</p>`;

    const { error: messageError } = await this.client.from('support_ticket_messages').insert({
      ticket_id: ticketId,
      sender_type: 'support',
      sender_name: dto.adminName?.trim() || 'WhapVibez Support',
      sender_email: dto.adminEmail?.trim() || this.smtpFrom,
      channel: 'admin',
      body_text: bodyText,
      body_html: bodyHtml,
      is_internal: false,
      created_at: now,
    });

    if (messageError) throw new InternalServerErrorException(messageError.message);

    const updatePayload: Record<string, any> = {
      status: 'pending_customer',
      updated_at: now,
      last_message_at: now,
      support_last_replied_at: now,
    };
    if (!ticket.first_response_at) updatePayload.first_response_at = now;

    const { error: ticketUpdateError } = await this.client
      .from('support_tickets')
      .update(updatePayload)
      .eq('id', ticketId);

    if (ticketUpdateError) throw new InternalServerErrorException(ticketUpdateError.message);

    if (dto.sendEmail !== false) {
      await this.sendSupportReplyEmail(ticket, bodyText, bodyHtml);
    }

    return { success: true };
  }

  async inboundEmail(dto: InboundEmailDto, secret?: string) {
    this.assertInboundSecret(secret || dto.secret);

    const subject = dto.subject.trim();
    const ticketNumber = this.extractTicketNumber(subject);
    const textBody = (dto.text || '').trim() || this.stripQuotedEmail(dto.html || '').trim();
    if (!textBody) throw new BadRequestException('Inbound email body is empty');

    if (dto.messageId) {
      const { data: existing } = await this.client
        .from('support_ticket_messages')
        .select('id')
        .eq('email_message_id', dto.messageId)
        .maybeSingle();
      if (existing) {
        return { success: true, duplicate: true };
      }
    }

    if (!ticketNumber) {
      return this.createTicket({
        requesterName: dto.fromName?.trim() || dto.from,
        requesterEmail: dto.from.trim().toLowerCase(),
        subject,
        description: textBody,
        priority: 'medium',
        source: 'email',
      });
    }

    const { data: ticket, error } = await this.client
      .from('support_tickets')
      .select('*')
      .eq('ticket_number', ticketNumber)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!ticket) throw new NotFoundException('Support ticket not found');

    const now = new Date().toISOString();
    const { error: msgError } = await this.client.from('support_ticket_messages').insert({
      ticket_id: ticket.id,
      sender_type: 'customer',
      sender_name: dto.fromName?.trim() || ticket.requester_name,
      sender_email: dto.from.trim().toLowerCase(),
      channel: 'email',
      body_text: textBody,
      body_html: dto.html?.trim() || `<p>${this.escapeHtml(textBody).replace(/\n/g, '<br/>')}</p>`,
      email_message_id: dto.messageId || null,
      in_reply_to: dto.inReplyTo || null,
      is_internal: false,
      created_at: now,
    });

    if (msgError) throw new InternalServerErrorException(msgError.message);

    const { error: updateError } = await this.client
      .from('support_tickets')
      .update({
        status: 'pending_support',
        updated_at: now,
        last_message_at: now,
        requester_last_replied_at: now,
      })
      .eq('id', ticket.id);

    if (updateError) throw new InternalServerErrorException(updateError.message);

    return { success: true, ticketId: ticket.id, ticketNumber: ticket.ticket_number };
  }

  private extractTicketNumber(subject: string) {
    const match = subject.match(/WV-\d{8}-[A-F0-9]{6}/i);
    return match?.[0]?.toUpperCase() || null;
  }

  private stripQuotedEmail(input: string) {
    return input
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .split(/\nOn .*wrote:|\nFrom: /i)[0]
      .trim();
  }

  private async sendTicketCreatedEmail(ticket: any) {
    const transporter = await this.createTransporter();
    if (!transporter) return;

    const subject = `[WhapVibez Support ${ticket.ticket_number}] Ticket received`;
    const trackUrl = `${this.supportPortalBaseUrl}/?ticket=${encodeURIComponent(ticket.ticket_number)}`;
    const text = [
      `Hi ${ticket.requester_name},`,
      '',
      `We received your support ticket ${ticket.ticket_number}.`,
      `Subject: ${ticket.subject}`,
      '',
      'Our team will review it and reply by email.',
      `Track your ticket: ${trackUrl}`,
      '',
      'When replying by email, keep the ticket number in the subject so the message stays attached to this ticket.',
      '',
      'WhapVibez Support',
    ].join('\n');

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111827;">
        <h2 style="margin:0 0 12px;">We received your ticket</h2>
        <p>Hi ${this.escapeHtml(ticket.requester_name)},</p>
        <p>Your support ticket <strong>${this.escapeHtml(ticket.ticket_number)}</strong> has been created.</p>
        <p><strong>Subject:</strong> ${this.escapeHtml(ticket.subject)}</p>
        <p>Our team will review it and reply by email.</p>
        <p><a href="${trackUrl}">Track your ticket</a></p>
        <p style="margin-top:24px;color:#6b7280;">When replying by email, keep the ticket number in the subject so the message stays attached to this ticket.</p>
      </div>
    `;

    await transporter.sendMail({
      from: `${this.smtpFromName} <${this.smtpFrom}>`,
      to: ticket.requester_email,
      subject,
      text,
      html,
    });
  }

  private async sendSupportReplyEmail(ticket: any, bodyText: string, bodyHtml: string) {
    const transporter = await this.createTransporter();
    if (!transporter) return;

    const subject = `[WhapVibez Support ${ticket.ticket_number}] ${ticket.subject}`;
    const text = [
      `Hi ${ticket.requester_name},`,
      '',
      'Our support team replied to your ticket.',
      '',
      bodyText,
      '',
      'Reply directly to this email to continue the conversation.',
      '',
      `Ticket: ${ticket.ticket_number}`,
      'WhapVibez Support',
    ].join('\n');

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111827;">
        <p>Hi ${this.escapeHtml(ticket.requester_name)},</p>
        <p>Our support team replied to your ticket <strong>${this.escapeHtml(ticket.ticket_number)}</strong>.</p>
        <div style="margin:16px 0;padding:16px;border:1px solid #e5e7eb;border-radius:16px;background:#f9fafb;">
          ${bodyHtml}
        </div>
        <p>Reply directly to this email to continue the conversation.</p>
        <p style="color:#6b7280;">Ticket: ${this.escapeHtml(ticket.ticket_number)}</p>
      </div>
    `;

    await transporter.sendMail({
      from: `${this.smtpFromName} <${this.smtpFrom}>`,
      to: ticket.requester_email,
      subject,
      text,
      html,
      replyTo: this.smtpFrom,
    });
  }
}
