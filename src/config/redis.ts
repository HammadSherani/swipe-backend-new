import Redis from 'ioredis';
import { env } from './env.js';

export const redis = new Redis(env.REDIS_URL);

redis.on('connect', () => {
  console.log('🔌 Redis connected');
});

redis.on('error', (err) => {
  console.error('❌ Redis error:', err);
});

// Helper functions for OTP
export const otpKey = (mobile: string) => `otp:${mobile}`;
export const sessionKey = (userId: string) => `session:${userId}`;

export async function storeOtp(mobile: string, code: string, expiresIn: number): Promise<void> {
  await redis.setex(otpKey(mobile), expiresIn, code);
}

export async function getOtp(mobile: string): Promise<string | null> {
  return redis.get(otpKey(mobile));
}

export async function deleteOtp(mobile: string): Promise<void> {
  await redis.del(otpKey(mobile));
}

export async function storeSession(userId: string, token: string, expiresIn: number): Promise<void> {
  await redis.setex(sessionKey(userId), expiresIn, token);
}

export async function getSession(userId: string): Promise<string | null> {
  return redis.get(sessionKey(userId));
}

export async function deleteSession(userId: string): Promise<void> {
  await redis.del(sessionKey(userId));
}
