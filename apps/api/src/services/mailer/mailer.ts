import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { loggerFor } from '../../core/logger/logger.js';

const log = loggerFor('mailer');

/**
 * Transactional email behind an interface (TRD §6), so the SMTP implementation
 * can be swapped for a provider API and stubbed in tests without touching a
 * single caller.
 *
 * Sends are best-effort from the caller's perspective: a failure is logged and
 * swallowed rather than thrown. Registration must not fail because the mail
 * server is briefly unreachable — the user has an account and can request
 * another verification link. Slice 2.4 moves this onto the BullMQ queue with
 * retries, which is where it belongs.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  /** Test seam: what was sent, when using the in-memory implementation. */
  sent?: MailMessage[];
}

class SmtpMailer implements Mailer {
  private transporter: Transporter | undefined;

  private transport(): Transporter {
    this.transporter ??= nodemailer.createTransport({
      host: env().SMTP_HOST,
      port: env().SMTP_PORT,
      secure: env().SMTP_SECURE,
      ...(env().SMTP_USER ? { auth: { user: env().SMTP_USER, pass: env().SMTP_PASSWORD } } : {}),
    });
    return this.transporter;
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transport().sendMail({
        from: env().MAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      log.info({ subject: message.subject }, 'email sent');
    } catch (error) {
      // Deliberately swallowed — see the class comment.
      log.error({ err: error, subject: message.subject }, 'email delivery failed');
    }
  }
}

export class InMemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  clear(): void {
    this.sent.length = 0;
  }
}

let instance: Mailer | undefined;

export function mailer(): Mailer {
  instance ??= env().NODE_ENV === 'test' ? new InMemoryMailer() : new SmtpMailer();
  return instance;
}

/** Test-only: swap in a double. */
export function setMailer(next: Mailer): void {
  instance = next;
}
