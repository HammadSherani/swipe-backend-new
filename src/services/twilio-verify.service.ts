import axios from 'axios';
import { env } from '../config/env.js';

const TWILIO_VERIFY_BASE_URL = 'https://verify.twilio.com/v2/Services';

function getTwilioConfig() {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_VERIFY_SERVICE_SID) {
    throw new Error(
      'Twilio Verify is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID.'
    );
  }

  return {
    username: env.TWILIO_ACCOUNT_SID,
    password: env.TWILIO_AUTH_TOKEN,
  };
}

/**
 * Twilio Verify expects an E.164 number. The API accepts the local formats
 * currently used by the app for Nigeria and Pakistan, as well as international
 * numbers for both countries.
 */
export function toE164Mobile(mobile: string): string {
  const value = mobile.trim().replace(/[\s()-]/g, '');

  if (/^0[789][01]\d{8}$/.test(value)) return `+234${value.slice(1)}`;
  if (/^234[789][01]\d{8}$/.test(value)) return `+${value}`;
  if (/^\+234[789][01]\d{8}$/.test(value)) return value;

  if (/^03\d{9}$/.test(value)) return `+92${value.slice(1)}`;
  if (/^92\d{10}$/.test(value)) return `+${value}`;
  if (/^\+92\d{10}$/.test(value)) return value;

  throw new Error('Invalid mobile number. Use a supported local number or E.164 format.');
}

function formBody(values: Record<string, string>): URLSearchParams {
  return new URLSearchParams(values);
}

export async function sendMobileVerification(mobile: string): Promise<void> {
  const auth = getTwilioConfig();
  const to = toE164Mobile(mobile);

  try {
    await axios.post(
      `${TWILIO_VERIFY_BASE_URL}/${env.TWILIO_VERIFY_SERVICE_SID}/Verifications`,
      formBody({ To: to, Channel: 'sms' }),
      {
        auth,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15_000,
      },
    );
  } catch (error) {
    const message = axios.isAxiosError(error) ? error.response?.data?.message : undefined;
    throw new Error(`Twilio could not send the verification SMS${message ? `: ${message}` : '.'}`);
  }
}

export async function checkMobileVerification(mobile: string, code: string): Promise<boolean> {
  const auth = getTwilioConfig();
  const to = toE164Mobile(mobile);

  try {
    const response = await axios.post<{ status?: string }>(
      `${TWILIO_VERIFY_BASE_URL}/${env.TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`,
      formBody({ To: to, Code: code }),
      {
        auth,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15_000,
      },
    );

    return response.data.status === 'approved';
  } catch {
    // Treat invalid, expired and exhausted codes uniformly. Provider details
    // should not be exposed to the client and are not needed by the caller.
    return false;
  }
}
