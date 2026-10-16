import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  loginRequestSchema,
  signupRequestSchema,
  type LoginRequest,
  type MeResponse,
  type SessionResponse,
  type SignupRequest,
} from '@despacho/shared';
import { ZodPipe } from '../common/zod.pipe.js';
import type { TenantContext } from '../db/tenant-transactions.js';
import type { AuthenticatedRequest } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { Public, Tenant } from './decorators.js';
import { SessionsService } from './sessions.service.js';

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginRequestSchema)) body: LoginRequest): Promise<SessionResponse> {
    return { token: await this.auth.login(body) };
  }

  @Public()
  @Post('auth/signup')
  async signup(@Body(new ZodPipe(signupRequestSchema)) body: SignupRequest): Promise<SessionResponse> {
    return { token: await this.auth.signup(body) };
  }

  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Req() req: AuthenticatedRequest): Promise<void> {
    if (req.sessionToken) await this.sessions.revoke(req.sessionToken);
  }

  @Get('me')
  me(@Tenant() tenant: TenantContext): Promise<MeResponse> {
    return this.auth.me(tenant.userId);
  }
}
