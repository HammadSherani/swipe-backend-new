import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { env } from '../config/env.js';

// Render's free plan blocks outbound SMTP, so Resend's HTTP API is used when a
// key is configured; SMTP stays as the fallback for local/other hosts.
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: Number(env.SMTP_PORT),
  secure: env.SMTP_SECURE === 'true',
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
});

interface MailOptions {
  to: string;
  subject: string;
  html: string;
}

async function sendMail({ to, subject, html }: MailOptions): Promise<void> {
  const from = `Swipe <${env.FROM_EMAIL}>`;

  if (resend) {
    const { error } = await resend.emails.send({ from, to, subject, html });
    if (error) throw new Error(`Resend: ${error.message}`);
    return;
  }

  await transporter.sendMail({ from, to, subject, html });
}

export async function sendOtpEmail(to: string, otp: string, name?: string): Promise<void> {
  await sendMail({
    to,
    subject: 'Your OTP Verification Code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333;">Hello ${name || 'User'},</h2>
        <p style="color: #666;">Your OTP code for verification is:</p>
        <div style="background: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333; border-radius: 8px; margin: 20px 0;">
          ${otp}
        </div>
        <p style="color: #666;">This code expires in 10 minutes.</p>
        <p style="color: #999; font-size: 12px; margin-top: 30px;">If you didn't request this, please ignore this email.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(to: string, otp: string, name?: string, resetLink?: string): Promise<void> {
  const link = resetLink || `${env.PASSWORD_RESET_URL}?email=${encodeURIComponent(to)}&otp=${encodeURIComponent(otp)}`;

  await sendMail({
    to,
    subject: 'Reset Your Swipe Password',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333;">Hello ${name || 'User'},</h2>
        <p style="color: #666;">We received a request to reset your password.</p>
        <p style="color: #666;">Click the button below to open the reset page:</p>
        <a href="${link}" style="display: inline-block; background: #007bff; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; margin: 16px 0;">Reset Password</a>
        <p style="color: #666;">If the button does not work, copy and paste this link into your browser:</p>
        <p style="color: #007bff; word-break: break-word;">${link}</p>
        <p style="color: #666;">Your OTP code is <strong>${otp}</strong>. It expires in 10 minutes.</p>
        <p style="color: #999; font-size: 12px; margin-top: 30px;">If you didn't request this, please ignore this email.</p>
      </div>
    `,
  });
}
