import { z } from 'zod';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../../.env') });

const envSchema = z.object({
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),

  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  // Base URL a phone can actually reach, used for the 'take the selfie on your
  // phone' link (localhost only works on the same machine). Falls back to the
  // origin the browser is using when empty.
  FRONTEND_PUBLIC_URL: z.string().default(''),

  OTP_EXPIRES_IN: z.string().default('300').transform(Number),
  OTP_MODE: z.enum(['static', 'live']).default('static'),

  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.string().default('587'),
  SMTP_SECURE: z.string().default('false'),
  SMTP_USER: z.string(),
  SMTP_PASS: z.string(),
  // Tolerate stray whitespace/quotes and a "Name <addr>" value from the host's
  // env UI; the email service adds the display name itself.
  FROM_EMAIL: z.preprocess(
    (v) =>
      typeof v === 'string'
        ? (v.match(/<([^>]+)>/)?.[1] ?? v).trim().replace(/^["']|["']$/g, '').trim()
        : v,
    z.string().email(),
  ),
  PASSWORD_RESET_URL: z.string().url().default('http://localhost:3000/auth/reset-password'),

  MONNIFY_BASE_URL: z.string().url().default('https://sandbox.monnify.com'),
  MONNIFY_API_KEY: z.string(),
  MONNIFY_SECRET_KEY: z.string(),
  MONNIFY_CONTRACT_CODE: z.string(),

  // Smile ID — identity verification (BVN/NIN/Face) for merchant KYC onboarding.
  SMILE_ID_PARTNER_ID: z.string().default(''),
  SMILE_ID_API_KEY: z.string().default(''),
  SMILE_ID_CALLBACK_URL: z.string().default('http://localhost:3010/merchant/kyc/webhook'),
  SMILE_ID_SERVER: z.enum(['0', '1']).default('0'), // '0' sandbox, '1' production

  // No real Smile ID credentials wired up yet, so KYC checks stay mocked
  // ('static') until live sandbox/production credentials are available.
  KYC_VERIFICATION_MODE: z.enum(['static', 'live']).default('static'),

  // Monnify's BVN-account match exists only on a Live Monnify account (not their
  // sandbox) and costs per call, so it's a separate switch from the Smile ID
  // checks above. Leave 'off' while Monnify is on sandbox keys.
  MONNIFY_BVN_MATCH: z.enum(['on', 'off']).default('off'),

  // Cloudinary — file/image storage (proof-of-address uploads, QR images).
  CLOUDINARY_CLOUD_NAME: z.string().default(''),
  CLOUDINARY_API_KEY: z.string().default(''),
  CLOUDINARY_API_SECRET: z.string().default(''),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}
export const env = parsed.data;
