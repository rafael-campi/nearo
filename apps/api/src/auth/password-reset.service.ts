import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { Clock } from '../clock.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { passwordResets, sessions, users } from '../db/schema.js';
import { DATABASE, type Database } from '../db/tenant-transactions.js';
import { Mailer } from '../mail/mailer.js';
import { hashPassword, hashToken, newToken } from './crypto.js';

const TOKEN_TTL_MS = 60 * 60_000;
/** No máximo um e-mail por minuto para a mesma conta. */
const THROTTLE_MS = 60_000;

/** Recuperação de senha por link enviado por e-mail, no painel e no app. */
@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly mailer: Mailer,
    private readonly clock: Clock,
  ) {}

  /** Envia o link se a conta existir. Quem chama responde igual nos dois casos (não revela o e-mail). */
  async request(email: string): Promise<void> {
    const now = this.clock.now();
    const [user] = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)));
    if (!user) return;

    const [recent] = await this.db
      .select({ id: passwordResets.id })
      .from(passwordResets)
      .where(and(eq(passwordResets.userId, user.id), gt(passwordResets.createdAt, new Date(now.getTime() - THROTTLE_MS))));
    if (recent) return;

    const token = newToken();
    await this.db.transaction(async (tx) => {
      // O link novo substitui os anteriores.
      await tx.update(passwordResets).set({ usedAt: now }).where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));
      await tx.insert(passwordResets).values({
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
        createdAt: now,
      });
    });
    await this.mailer.send({
      to: user.email,
      subject: 'Redefinir sua senha no Despacho',
      text: [
        'Recebemos um pedido para redefinir a senha da sua conta no Despacho.',
        '',
        `No painel da empresa: ${this.config.ADMIN_URL}/reset-password/${token}`,
        `No aplicativo: despacho://reset-password/${token}`,
        '',
        'O link vale por 1 hora e só pode ser usado uma vez. Se você não pediu, ignore este e-mail.',
      ].join('\n'),
    });
  }

  /** Define a senha nova com o link: vale uma vez, expira e encerra todas as sessões da conta. */
  async reset(token: string, password: string): Promise<void> {
    const now = this.clock.now();
    const passwordHash = await hashPassword(password);
    const done = await this.db.transaction(async (tx) => {
      // Marca primeiro: de dois usos simultâneos, só um encontra o link em aberto.
      const [claimed] = await tx
        .update(passwordResets)
        .set({ usedAt: now })
        .where(and(eq(passwordResets.tokenHash, hashToken(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, now)))
        .returning({ userId: passwordResets.userId });
      if (!claimed) return false;
      const updated = await tx
        .update(users)
        .set({ passwordHash })
        .where(and(eq(users.id, claimed.userId), isNull(users.deletedAt)))
        .returning({ id: users.id });
      if (updated.length === 0) return false;
      // Quem esqueceu a senha pode ter a conta aberta em outro lugar: todas as sessões saem.
      await tx.delete(sessions).where(eq(sessions.userId, claimed.userId));
      await tx.update(passwordResets).set({ usedAt: now }).where(and(eq(passwordResets.userId, claimed.userId), isNull(passwordResets.usedAt)));
      return true;
    });
    if (!done) throw new BadRequestException('Link inválido ou expirado. Peça um novo.');
  }
}
