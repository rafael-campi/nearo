import { Global, Injectable, Logger, Module } from '@nestjs/common';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Envio de e-mail. Em dev escreve no console; nos testes, uma implementação falsa captura as mensagens. */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}

@Injectable()
export class ConsoleMailer extends Mailer {
  private readonly logger = new Logger('Mailer');

  async send({ to, subject, text }: MailMessage): Promise<void> {
    this.logger.log(`Para: ${to}\nAssunto: ${subject}\n\n${text}`);
  }
}

@Global()
@Module({
  providers: [{ provide: Mailer, useClass: ConsoleMailer }],
  exports: [Mailer],
})
export class MailModule {}
