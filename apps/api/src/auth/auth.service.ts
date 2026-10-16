import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { LoginRequest, MeResponse, SignupRequest } from '@despacho/shared';
import { and, eq } from 'drizzle-orm';
import { isUniqueViolation } from '../common/db-errors.js';
import { companies, memberships, users } from '../db/schema.js';
import { DATABASE, TenantTransactions, type Database } from '../db/tenant-transactions.js';
import { hashPassword, verifyPassword } from './crypto.js';
import { SessionsService } from './sessions.service.js';

// Comparação contra um hash qualquer quando o e-mail não existe, para não revelar quais e-mails têm conta pelo tempo.
const dummyHash = hashPassword('senha-que-ninguem-usa');

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly transactions: TenantTransactions,
    private readonly sessions: SessionsService,
  ) {}

  /** Usuário com essa senha, ou null. */
  async verifyCredentials(email: string, password: string): Promise<{ id: string } | null> {
    const [user] = await this.db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email));
    const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
    return user && ok ? { id: user.id } : null;
  }

  async login({ email, password }: LoginRequest): Promise<string> {
    const user = await this.verifyCredentials(email, password);
    if (!user) throw new UnauthorizedException('E-mail ou senha incorretos');
    return this.sessions.create(user.id);
  }

  /** Cadastro próprio (cliente). Entra logado. */
  async signup({ name, email, password, phone }: SignupRequest): Promise<string> {
    try {
      const [user] = await this.db
        .insert(users)
        .values({ name, email, phone, passwordHash: await hashPassword(password) })
        .returning({ id: users.id });
      return await this.sessions.create(user.id);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Já existe uma conta com esse e-mail');
      throw error;
    }
  }

  /** Roda numa transação sem empresa: vê só os próprios vínculos, em empresas ativas. */
  async me(userId: string): Promise<MeResponse> {
    const tx = this.transactions.current();
    const [user] = await tx
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    const rows = await tx
      .select({ companyId: companies.id, companyName: companies.name, role: memberships.role })
      .from(memberships)
      .innerJoin(companies, eq(companies.id, memberships.companyId))
      .where(and(eq(memberships.userId, userId), eq(memberships.active, true), eq(companies.active, true)))
      .orderBy(companies.name);
    return { user, memberships: rows };
  }
}
