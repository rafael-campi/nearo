import { Mailer, type MailMessage } from '../../src/mail/mailer.js';

export class FakeMailer extends Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  /** Token do último e-mail de recuperação de senha enviado para este endereço. */
  resetTokenFor(email: string): string {
    const message = this.sent.findLast((m) => m.to === email && m.subject.includes('Redefinir'));
    const token = message?.text.match(/\/reset-password\/([\w-]+)/)?.[1];
    if (!token) throw new Error(`Nenhuma recuperação de senha enviada para ${email}`);
    return token;
  }

  /** Token do último convite enviado para este e-mail. */
  inviteTokenFor(email: string): string {
    const message = this.sent.findLast((m) => m.to === email);
    const token = message?.text.match(/\/invites\/([\w-]+)/)?.[1];
    if (!token) throw new Error(`Nenhum convite enviado para ${email}`);
    return token;
  }
}
