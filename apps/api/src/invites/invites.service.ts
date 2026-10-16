import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  AcceptInviteRequest,
  AcceptInviteResponse,
  Invite,
  InvitePreview,
  MembershipRole,
} from '@despacho/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { AuthService } from '../auth/auth.service.js';
import { hashPassword, hashToken, newToken } from '../auth/crypto.js';
import { SessionsService } from '../auth/sessions.service.js';
import { Clock } from '../clock.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { invites, memberships, users } from '../db/schema.js';
import { DATABASE, TenantTransactions, type Database, type Transaction } from '../db/tenant-transactions.js';
import { Mailer } from '../mail/mailer.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type InviteRow = {
  id: string;
  company_id: string;
  company_name: string;
  company_active: boolean;
  email: string;
  role: MembershipRole;
  expires_at: Date;
  accepted_at: Date | null;
};

@Injectable()
export class InvitesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly transactions: TenantTransactions,
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly mailer: Mailer,
    private readonly clock: Clock,
  ) {}

  /** Cria o convite e envia o link por e-mail. Recebe a transação de quem chama (API ou script). */
  async create(
    tx: Database | Transaction,
    input: { companyId: string; companyName: string; email: string; role: MembershipRole; invitedBy: string | null },
  ): Promise<Invite> {
    const token = newToken();
    const [invite] = await tx
      .insert(invites)
      .values({
        companyId: input.companyId,
        email: input.email,
        role: input.role,
        tokenHash: hashToken(token),
        expiresAt: new Date(this.clock.now().getTime() + INVITE_TTL_MS),
        invitedBy: input.invitedBy,
      })
      .returning({ id: invites.id, email: invites.email, role: invites.role, expiresAt: invites.expiresAt });
    await this.mailer.send({
      to: input.email,
      subject: `Convite para ${input.companyName} no Despacho`,
      text: `Você foi convidado para ${input.companyName}.\n\nAceite em: ${this.config.ADMIN_URL}/invites/${token}\n\nO convite vale por 7 dias.`,
    });
    return { ...invite, expiresAt: invite.expiresAt.toISOString() };
  }

  async preview(token: string): Promise<InvitePreview> {
    const invite = await this.findUsable(token);
    return {
      companyName: invite.company_name,
      email: invite.email,
      role: invite.role,
      hasAccount: (await this.findUserId(invite.email)) !== null,
    };
  }

  async accept(token: string, body: AcceptInviteRequest): Promise<AcceptInviteResponse> {
    const invite = await this.findUsable(token);
    const userId = await this.resolveUser(invite.email, body);

    await this.transactions.run({ userId, companyId: invite.company_id }, async (tx) => {
      // Marca primeiro: de dois aceites simultâneos, só um encontra o convite em aberto.
      const claimed = await tx
        .update(invites)
        .set({ acceptedAt: this.clock.now() })
        .where(and(eq(invites.id, invite.id), isNull(invites.acceptedAt)))
        .returning({ id: invites.id });
      if (claimed.length === 0) throw new NotFoundException('Convite inválido ou expirado');
      await tx
        .insert(memberships)
        .values({ companyId: invite.company_id, userId, role: invite.role })
        .onConflictDoUpdate({
          target: [memberships.companyId, memberships.userId, memberships.role],
          set: { active: true },
        });
    });

    return { token: await this.sessions.create(userId), companyId: invite.company_id };
  }

  /** Conta existente confirma com a senha atual; quem não tem conta cria uma com nome e senha. */
  private async resolveUser(email: string, body: AcceptInviteRequest): Promise<string> {
    const existingId = await this.findUserId(email);
    if (existingId) {
      const user = await this.auth.verifyCredentials(email, body.password);
      if (!user) throw new UnauthorizedException('Senha incorreta');
      return user.id;
    }
    if (!body.name) throw new BadRequestException({ message: 'Dados inválidos', issues: [{ path: 'name', message: 'Informe seu nome' }] });
    const [user] = await this.db
      .insert(users)
      .values({ email, name: body.name, passwordHash: await hashPassword(body.password) })
      .returning({ id: users.id });
    return user.id;
  }

  private async findUserId(email: string): Promise<string | null> {
    const [user] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    return user?.id ?? null;
  }

  private async findUsable(token: string): Promise<InviteRow> {
    const { rows } = await this.db.execute<InviteRow>(
      sql`select * from app.invite_by_token_hash(${hashToken(token)})`,
    );
    const invite = rows[0];
    const usable =
      invite &&
      invite.company_active &&
      !invite.accepted_at &&
      new Date(invite.expires_at).getTime() > this.clock.now().getTime();
    if (!usable) throw new NotFoundException('Convite inválido ou expirado');
    return invite;
  }
}
