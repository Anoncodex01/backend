import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { SupportService } from './support.service';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { UpdateSupportTicketDto } from './dto/update-support-ticket.dto';
import { AdminReplyTicketDto } from './dto/admin-reply-ticket.dto';
import { InboundEmailDto } from './dto/inbound-email.dto';

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get('categories')
  async categories() {
    return this.supportService.listCategories();
  }

  @Get('articles')
  async articles(
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    return this.supportService.listArticles(search, category);
  }

  @Get('articles/:slug')
  async article(@Param('slug') slug: string) {
    return this.supportService.getArticle(slug);
  }

  @Post('tickets')
  async createTicket(@Body() dto: CreateSupportTicketDto) {
    return this.supportService.createTicket(dto);
  }

  @Post('inbound-email')
  async inboundEmail(
    @Body() dto: InboundEmailDto,
    @Headers('x-support-secret') secret?: string,
  ) {
    return this.supportService.inboundEmail(dto, secret);
  }

  @Get('admin/tickets')
  async adminTickets(
    @Headers('x-admin-secret') secret: string,
    @Query() query: Record<string, any>,
  ) {
    return this.supportService.listAdminTickets(secret, query);
  }

  @Get('admin/tickets/:ticketId')
  async adminTicket(
    @Headers('x-admin-secret') secret: string,
    @Param('ticketId') ticketId: string,
  ) {
    return this.supportService.getAdminTicket(secret, ticketId);
  }

  @Patch('admin/tickets/:ticketId')
  async updateAdminTicket(
    @Headers('x-admin-secret') secret: string,
    @Param('ticketId') ticketId: string,
    @Body() dto: UpdateSupportTicketDto,
  ) {
    return this.supportService.updateAdminTicket(secret, ticketId, dto);
  }

  @Post('admin/tickets/:ticketId/reply')
  async replyToTicket(
    @Headers('x-admin-secret') secret: string,
    @Param('ticketId') ticketId: string,
    @Body() dto: AdminReplyTicketDto,
  ) {
    return this.supportService.replyToTicket(secret, ticketId, dto);
  }
}
