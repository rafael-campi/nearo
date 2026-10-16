import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable, Logger, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { REDIS } from '../redis/redis.module.js';

export const RATE_LIMIT = 'rateLimit';

interface LimitedRequest {
  ip?: string;
  body?: unknown;
  params?: Record<string, string | undefined>;
}

export interface RateLimitRule {
  /** Escopo do contador: cada rota (ou grupo de rotas) tem o seu. */
  scope: string;
  /** Tentativas permitidas na janela. */
  limit: number;
  windowSeconds: number;
  /** O que identifica quem tenta: o IP de quem chama, o e-mail do corpo ou o token da URL. */
  by: 'ip' | 'email' | 'token';
}

/** Limita as tentativas numa rota pública. Várias regras valem juntas (ex.: por IP e por e-mail). */
export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(RATE_LIMIT, rules);

function subjectOf(rule: RateLimitRule, req: LimitedRequest): string | null {
  if (rule.by === 'ip') return req.ip ?? null;
  if (rule.by === 'token') return req.params?.token ?? null;
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' ? email.trim().toLowerCase() : null;
}

/**
 * Contador por janela fixa no Redis. Se o Redis falhar, deixa passar (e registra): o limite é uma
 * proteção, não pode derrubar o login.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger('RateLimit');

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http' || this.config.RATE_LIMIT === 'off') return true;
    const rules = this.reflector.getAllAndOverride<RateLimitRule[] | undefined>(RATE_LIMIT, [context.getHandler(), context.getClass()]);
    if (!rules) return true;
    const req = context.switchToHttp().getRequest<LimitedRequest>();
    for (const rule of rules) {
      const subject = subjectOf(rule, req);
      if (!subject) continue;
      const key = `rate:${rule.scope}:${rule.by}:${subject}`;
      try {
        const count = await this.redis.incr(key);
        if (count === 1) await this.redis.expire(key, rule.windowSeconds);
        if (count > rule.limit) {
          throw new HttpException('Muitas tentativas. Tente de novo em alguns minutos.', HttpStatus.TOO_MANY_REQUESTS);
        }
      } catch (error) {
        if (error instanceof HttpException) throw error;
        this.logger.error(`Limite de tentativas indisponível: ${(error as Error).message}`);
      }
    }
    return true;
  }
}
