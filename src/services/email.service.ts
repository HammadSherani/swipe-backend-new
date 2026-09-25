import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: Number(env.SMTP_PORT),
  secure: env.SMTP_SECURE === 'true',
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
});

export async function sendOtpEmail(to: string, otp: string, name?: string): Promise<void> {
  await transporter.sendMail({
    from: `"Swipe" <${env.FROM_EMAIL}>`,
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

  await transporter.sendMail({
    from: `"Swipe" <${env.FROM_EMAIL}>`,
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
