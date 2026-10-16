import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt } from 'drizzle-orm';
import { Clock } from '../clock.js';
import { sessions } from '../db/schema.js';
import { DATABASE, type Database } from '../db/tenant-transactions.js';
import { hashToken, newToken } from './crypto.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class SessionsService {
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
  }
}
