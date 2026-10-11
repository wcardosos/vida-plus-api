import type { FastifyBaseLogger } from 'fastify';

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export function createConsoleEmailSender(logger: FastifyBaseLogger): EmailSender {
  return {
    async send(message) {
      logger.info({ email: message }, 'email delivered to console');
    },
  };
}
