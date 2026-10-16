import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { Clock } from '../clock.js';
import { users } from '../db/schema.js';
import { TenantTransactions } from '../db/tenant-transactions.js';
import { AuthService } from './auth.service.js';
import { hashPassword } from './crypto.js';

const BLOCKED: Record<string, string> = {
  client_request: 'Você tem um pedido aberto ou em andamento. Cancele ou aguarde a conclusão antes de excluir a conta.',
  provider_request: 'Você tem um pedido em andamento como prestador. Conclua ou desista dele antes de excluir a conta.',
  sole_admin: 'Você é o único administrador de uma empresa. Convide outro administrador antes de excluir a conta.',
};

/** Exclusão da própria conta (exigência das lojas e LGPD). */
@Injectable()
export class AccountService {
  constructor(
    private readonly transactions: TenantTransactions,
    private readonly auth: AuthService,
    private readonly clock: Clock,
  ) {}

  async delete(userId: string, password: string): Promise<void> {
    const tx = this.transactions.current();
    const [user] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId));
    if (!user) throw new NotFoundException();
    if (!(await this.auth.verifyCredentials(user.email, password))) throw new UnauthorizedException('Senha incorreta');

    // O e-mail anonimizado libera o original para um cadastro novo; a senha vira uma que ninguém conhece.
    const { rows } = await tx.execute<{ blocker: string | null }>(sql`
      select app.delete_account(
        ${userId},
        ${`removido-${randomUUID()}@removido.invalid`},
        ${await hashPassword(randomUUID())},
        ${this.clock.now().toISOString()}::timestamptz
      ) as blocker`);
    const blocker = rows[0].blocker;
    if (blocker === 'not_found') throw new NotFoundException();
    if (blocker) throw new ConflictException(BLOCKED[blocker]);
  }
}
