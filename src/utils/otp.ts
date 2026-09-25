import crypto from 'crypto';

export const generateOtp = (): string => {
  return crypto.randomInt(100000, 999999).toString();
};

export const verifyOtp = (inputCode: string, storedCode: string): boolean => {
  if (inputCode.length !== storedCode.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(inputCode),
    Buffer.from(storedCode)
  );
};
