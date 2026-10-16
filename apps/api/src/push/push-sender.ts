import { Inject, Injectable, Logger } from '@nestjs/common';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { APP_CONFIG, type AppConfig } from '../config.js';

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface PushResult {
  /** Tokens que o provedor recusou como inexistentes ou vencidos: devem ser removidos. */
  invalidTokens: string[];
}

/** Envio de push (FCM) atrás de uma interface: os testes usam uma versão falsa. */
export abstract class PushSender {
  abstract send(messages: PushMessage[]): Promise<PushResult>;
}

const INVALID_TOKEN_CODES = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

@Injectable()
export class FcmPushSender extends PushSender {
  private readonly logger = new Logger('FcmPushSender');
  private app: App | null = null;
  private warned = false;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }

  async send(messages: PushMessage[]): Promise<PushResult> {
    const app = this.connection();
    if (!app || messages.length === 0) return { invalidTokens: [] };
    const response = await getMessaging(app).sendEach(
      messages.map((m) => ({
        token: m.token,
        notification: { title: m.title, body: m.body },
        data: m.data,
        android: { priority: 'high' as const, notification: { channelId: 'default' } },
      })),
    );
    const invalidTokens: string[] = [];
    response.responses.forEach((r, i) => {
      if (r.success) return;
      if (r.error && INVALID_TOKEN_CODES.has(r.error.code)) invalidTokens.push(messages[i].token);
      else this.logger.warn(`Push não enviado: ${r.error?.code ?? 'erro desconhecido'}`);
    });
    return { invalidTokens };
  }

  /** Sem credenciais, a API sobe e ignora o push (dev). */
  private connection(): App | null {
    if (this.app) return this.app;
    const json = this.config.FCM_SERVICE_ACCOUNT_JSON;
    if (!json) {
      if (!this.warned) this.logger.warn('FCM_SERVICE_ACCOUNT_JSON não configurado: push desligado');
      this.warned = true;
      return null;
    }
    this.app = getApps()[0] ?? initializeApp({ credential: cert(JSON.parse(json)) });
    return this.app;
  }
}
