import { redis } from './redis.js';

// Rate limit config
const MAX_OTP_REQUESTS = 30;
const WINDOW_SECONDS = 600; // 10 minutes

export async function checkOtpRateLimit(mobile: string): Promise<{
  allowed: boolean;
  remaining: number;
  resetTime: number;
}> {
  const key = `ratelimit:otp:${mobile}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - WINDOW_SECONDS;

  // Remove old entries outside window
  await redis.zremrangebyscore(key, 0, windowStart);

  // Count requests in current window
  const requestCount = await redis.zcard(key);

  if (requestCount >= MAX_OTP_REQUESTS) {
    // Get oldest request time for reset
    const oldestRequest = await redis.zrange(key, 0, 0, 'WITHSCORES');
    const resetTime = oldestRequest.length > 1 ? parseInt(oldestRequest[1]) + WINDOW_SECONDS : now + WINDOW_SECONDS;

    return {
      allowed: false,
      remaining: 0,
      resetTime,
    };
  }

  // Add current request
  await redis.zadd(key, now, `${now}-${Math.random()}`);

  // Set expiry on key
  await redis.expire(key, WINDOW_SECONDS);

  const remaining = MAX_OTP_REQUESTS - requestCount - 1;

  return {
    allowed: true,
    remaining,
    resetTime: now + WINDOW_SECONDS,
  };
}
