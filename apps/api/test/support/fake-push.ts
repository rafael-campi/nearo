import { PushSender, type PushMessage, type PushResult } from '../../src/push/push-sender.js';

/** Push falso: guarda o que "enviou" e recusa os tokens marcados como inválidos. */
export class FakePushSender extends PushSender {
  readonly sent: PushMessage[] = [];
  readonly invalid = new Set<string>();

  async send(messages: PushMessage[]): Promise<PushResult> {
    const invalidTokens = messages.filter((m) => this.invalid.has(m.token)).map((m) => m.token);
    this.sent.push(...messages.filter((m) => !this.invalid.has(m.token)));
    return { invalidTokens };
  }
}
