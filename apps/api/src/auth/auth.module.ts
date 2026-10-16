import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountService } from './account.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { SessionsService } from './sessions.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, AccountService, PasswordResetService, SessionsService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService, SessionsService],
})
export class AuthModule {}
