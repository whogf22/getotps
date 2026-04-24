import { Resend } from "resend";
import nodemailer from "nodemailer";
import { logger } from "./logger";

/** Captured in tests only (NODE_ENV=test). */
export const testEmailCapture = {
  lastVerifyJwt: "" as string,
  lastResetToken: "" as string,
};

function baseUrl(): string {
  return (process.env.FRONTEND_URL || process.env.APP_URL || "http://localhost:5000").replace(/\/$/, "");
}

function wrapHtml(title: string, inner: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">${inner}</body></html>`;
}

export async function sendEmailVerificationMessage(opts: { to: string; verifyToken: string }): Promise<void> {
  const url = `${baseUrl()}/verify-email?token=${encodeURIComponent(opts.verifyToken)}`;
  if (process.env.NODE_ENV === "test") {
    testEmailCapture.lastVerifyJwt = opts.verifyToken;
  }
  const html = wrapHtml(
    "Verify your email",
    `<h1>Verify your email</h1><p>Click the link below to activate your account:</p><p><a href="${url}">${url}</a></p><p>This link expires in 48 hours.</p>`,
  );
  await sendHtmlEmail({ to: opts.to, subject: "Verify your GetOTPs email", html });
}

export async function sendPasswordResetMessage(opts: { to: string; resetToken: string }): Promise<void> {
  const url = `${baseUrl()}/reset-password?token=${encodeURIComponent(opts.resetToken)}`;
  if (process.env.NODE_ENV === "test") {
    testEmailCapture.lastResetToken = opts.resetToken;
  }
  const html = wrapHtml(
    "Reset your password",
    `<h1>Password reset</h1><p>Click the link to choose a new password:</p><p><a href="${url}">${url}</a></p><p>This link expires in 1 hour.</p>`,
  );
  await sendHtmlEmail({ to: opts.to, subject: "Reset your GetOTPs password", html });
}

async function sendHtmlEmail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const from =
    process.env.SMTP_FROM ||
    process.env.RESEND_FROM ||
    process.env.MAIL_FROM ||
    "GetOTPs <onboarding@resend.dev>";

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (resendKey) {
    try {
      const resend = new Resend(resendKey);
      const { error } = await resend.emails.send({
        from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
      });
      if (error) throw new Error(error.message);
      logger.info({ to: opts.to, subject: opts.subject }, "email_sent_resend");
      return;
    } catch (e) {
      logger.error({ err: e }, "resend_failed_trying_smtp");
    }
  }

  const host = process.env.SMTP_HOST?.trim();
  if (host) {
    const port = Number(process.env.SMTP_PORT || "587");
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
    });
    await transporter.sendMail({ from, to: opts.to, subject: opts.subject, html: opts.html });
    logger.info({ to: opts.to, subject: opts.subject }, "email_sent_smtp");
    return;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Email not configured: set RESEND_API_KEY or SMTP_HOST");
  }
  logger.warn({ to: opts.to, subject: opts.subject }, "email_skipped_no_provider_dev");
}
