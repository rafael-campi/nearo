import { Body, Controller, Delete, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  deleteAccountRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  resetPasswordRequestSchema,
  signupRequestSchema,
  type DeleteAccountRequest,
  type ForgotPasswordRequest,
  type LoginRequest,
  type MeResponse,
  type ResetPasswordRequest,
  type SessionResponse,
  type SignupRequest,
} from '@despacho/shared';
import { ZodPipe } from '../common/zod.pipe.js';
import type { TenantContext } from '../db/tenant-transactions.js';
import type { AuthenticatedRequest } from './auth.guard.js';
import { AccountService } from './account.service.js';
import { AuthService } from './auth.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { Public, Tenant } from './decorators.js';
import { RateLimit } from './rate-limit.js';

const QUARTER_HOUR = 15 * 60;
const HOUR = 60 * 60;
import { SessionsService } from './sessions.service.js';

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly account: AccountService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Public()
  @RateLimit(
    { scope: 'login', limit: 30, windowSeconds: QUARTER_HOUR, by: 'ip' },
    { scope: 'login', limit: 10, windowSeconds: QUARTER_HOUR, by: 'email' },
  )
  @Post('auth/login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginRequestSchema)) body: LoginRequest): Promise<SessionResponse> {
    return { token: await this.auth.login(body) };
  }

  @Public()
  @RateLimit({ scope: 'signup', limit: 10, windowSeconds: HOUR, by: 'ip' })
  @Post('auth/signup')
  async signup(@Body(new ZodPipe(signupRequestSchema)) body: SignupRequest): Promise<SessionResponse> {
    return { token: await this.auth.signup(body) };
  }

  /** Sempre 204, exista ou não a conta: o pedido não revela quais e-mails estão cadastrados. */
  @Public()
  @RateLimit(
    { scope: 'forgot', limit: 10, windowSeconds: HOUR, by: 'ip' },
    { scope: 'forgot', limit: 5, windowSeconds: HOUR, by: 'email' },
  )
  @Post('auth/forgot-password')
  @HttpCode(204)
  async forgotPassword(@Body(new ZodPipe(forgotPasswordRequestSchema)) body: ForgotPasswordRequest): Promise<void> {
    await this.passwordReset.request(body.email);
  }

  @Public()
  @RateLimit({ scope: 'reset', limit: 10, windowSeconds: QUARTER_HOUR, by: 'ip' })
  @Post('auth/reset-password')
  @HttpCode(204)
  async resetPassword(@Body(new ZodPipe(resetPasswordRequestSchema)) body: ResetPasswordRequest): Promise<void> {
    await this.passwordReset.reset(body.token, body.password);
  }

  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Req() req: AuthenticatedRequest): Promise<void> {
    if (req.sessionToken) await this.sessions.revoke(req.sessionToken);
  }

  /** Exclui a própria conta (pede a senha). Bloqueada com pedido aberto ou ativo. */
  @Delete('my/account')
  @HttpCode(204)
  async deleteAccount(
    @Tenant() tenant: TenantContext,
    @Body(new ZodPipe(deleteAccountRequestSchema)) body: DeleteAccountRequest,
  ): Promise<void> {
    await this.account.delete(tenant.userId, body.password);
  }

  @Get('me')
  me(@Tenant() tenant: TenantContext): Promise<MeResponse> {
    return this.auth.me(tenant.userId);
  }
}
