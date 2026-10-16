import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt } from 'drizzle-orm';
import { Clock } from '../clock.js';
import { sessions } from '../db/schema.js';
import { DATABASE, type Database } from '../db/tenant-transactions.js';
import { hashToken, newToken } from './crypto.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Quem precisa saber que uma sessão deixou de valer (ex.: o socket, que não pode seguir conectado). */
export type SessionRevocation = { tokenHash: string } | { userId: string };

@Injectable()
export class SessionsService {
  private readonly listeners: ((revocation: SessionRevocation) => void)[] = [];

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  async create(userId: string): Promise<string> {
    const token = newToken();
    await this.db.insert(sessions).values({
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(this.clock.now().getTime() + SESSION_TTL_MS),
    });
    return token;
  }

  async userIdForToken(token: string): Promise<string | null> {
    const [session] = await this.db
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, this.clock.now())));
    return session?.userId ?? null;
  }

  async revoke(token: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    this.announce({ tokenHash: hashToken(token) });
  }

  onRevoked(listener: (revocation: SessionRevocation) => void): void {
    this.listeners.push(listener);
  }

  /** Todas as sessões da pessoa já foram apagadas (troca de senha, exclusão da conta): avisa quem as usava. */
  revokedAllOf(userId: string): void {
    this.announce({ userId });
  }

  private announce(revocation: SessionRevocation): void {
    for (const listener of this.listeners) listener(revocation);
  }
}
