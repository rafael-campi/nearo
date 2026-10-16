import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import type { CreateUploadRequest, PhotoPurpose, UploadTicket } from '@despacho/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Clock } from '../clock.js';
import { memberships, uploads } from '../db/schema.js';
import { TenantTransactions } from '../db/tenant-transactions.js';
import { Storage } from '../storage/storage.js';

/**
 * Fotos (ADR 0009): a API autoriza o envio direto ao storage, guarda quem pediu cada chave e só a
 * entrega a um pedido ou mensagem uma vez, dentro da mesma empresa. O link de leitura só é gerado nas
 * respostas em que a pessoa já passou pela conferência de acesso.
 */
@Injectable()
export class PhotosService {
  constructor(
    private readonly transactions: TenantTransactions,
    private readonly storage: Storage,
    private readonly clock: Clock,
  ) {}

  async createUpload(userId: string, companyId: string, input: CreateUploadRequest): Promise<UploadTicket & { key: string }> {
    // Foto do pedido é do cliente; foto do chat, de quem conversa (cliente ou prestador).
    const roles = input.purpose === 'request_photo' ? ['client'] : ['client', 'provider'];
    const [member] = await this.transactions
      .current()
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.companyId, sql`app.current_company_id()`),
          eq(memberships.userId, userId),
          eq(memberships.active, true),
          inArray(memberships.role, roles as ('client' | 'provider')[]),
        ),
      );
    if (!member) throw new NotFoundException();

    const key = `${companyId}/${randomUUID()}.jpg`;
    const ticket = await this.storage.presignUpload(key, input.contentLength);
    await this.transactions
      .current()
      .insert(uploads)
      .values({ key, companyId, userId, purpose: input.purpose, createdAt: this.clock.now() });
    return { key, ...ticket };
  }

  /**
   * Confere que cada chave foi emitida para esta pessoa, neste uso e nesta empresa, e ainda não foi
   * usada; então a marca como usada. Chave inválida vira 400 no campo indicado.
   */
  async claim(userId: string, keys: string[], purpose: PhotoPurpose, field: string): Promise<void> {
    if (keys.length === 0) return;
    const unique = [...new Set(keys)];
    const claimed = await this.transactions
      .current()
      .update(uploads)
      .set({ usedAt: this.clock.now() })
      .where(
        and(
          inArray(uploads.key, unique),
          eq(uploads.userId, userId),
          eq(uploads.purpose, purpose),
          eq(uploads.companyId, sql`app.current_company_id()`),
          isNull(uploads.usedAt),
        ),
      )
      .returning({ key: uploads.key });
    if (unique.length !== keys.length || claimed.length !== unique.length) {
      throw new BadRequestException({ message: 'Dados inválidos', issues: [{ path: field, message: 'Foto inválida' }] });
    }
  }

  /** Links de leitura (valem 1 h) para chaves de fotos a que a pessoa já tem acesso. */
  readUrls(keys: string[]): Promise<string[]> {
    return Promise.all(keys.map((key) => this.storage.presignRead(key)));
  }
}
