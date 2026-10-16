import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { sendMessageSchema, type Message, type MessagePage, type SendMessage } from '@despacho/shared';
import { CompanyRoles, Tenant } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { TenantContext } from '../db/tenant-transactions.js';
import { ChatService } from './chat.service.js';

const idPipe = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@Controller('company/service-requests/:id/messages')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @CompanyRoles('client', 'provider')
  @Post()
  @HttpCode(200)
  send(
    @Tenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodPipe(sendMessageSchema)) body: SendMessage,
  ): Promise<Message> {
    return this.chat.send(tenant.userId, id, body);
  }

  @CompanyRoles('client', 'provider', 'admin')
  @Get()
  list(
    @Tenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Query('cursor') cursor?: string,
  ): Promise<MessagePage> {
    return this.chat.list(tenant.userId, id, cursor);
  }
}
