import { IDApi, WebApi, JOB_TYPE, IMAGE_TYPE } from 'smile-identity-core';
import { env } from '../config/env.js';

const PARTNER_ID = env.SMILE_ID_PARTNER_ID;
const API_KEY = env.SMILE_ID_API_KEY;
const CALLBACK_URL = env.SMILE_ID_CALLBACK_URL;
const SID_SERVER = env.SMILE_ID_SERVER;

export class SmileIdApiError extends Error {
  constructor(message: string, public raw?: unknown) {
    super(message);
    this.name = 'SmileIdApiError';
  }
}

export type SmileIdMatchStatus = 'VERIFIED' | 'FAILED' | 'MANUAL_REVIEW';

export interface SmileIdIdCheckInput {
  idNumber: string;
  idType: 'BVN' | 'NIN';
  firstName: string;
  lastName: string;
  dob: string; // yyyy-mm-dd
  phoneNumber: string;
  userId: string;
  jobId: string;
}

export interface SmileIdIdCheckResult {
  status: SmileIdMatchStatus;
  /** Provider-returned full name, when present — not guaranteed on every account/product config. */
  matchedName?: string;
  raw: Record<string, unknown>;
}

export interface SmileIdFaceCheckInput {
  selfieImageBase64: string;
  bvn: string;
  userId: string;
  jobId: string;
}

export interface SmileIdFaceCheckResult {
  status: SmileIdMatchStatus;
  confidence?: number;
  raw: Record<string, unknown>;
}

// Confirmed against Smile ID's docs: Nigeria's Business Registration product
// only accepts these three business_type codes — bn (CAC Business Name,
// used by sole proprietorships/partnerships), co (CAC RC/registered
// company), it (Incorporated Trustees).
export type SmileIdBusinessType = 'bn' | 'co' | 'it';

export interface SmileIdBusinessCheckInput {
  registrationNumber: string;
  businessType: SmileIdBusinessType;
  userId: string;
  jobId: string;
}

export interface SmileIdBusinessCheckResult {
  status: SmileIdMatchStatus;
  /** e.g. "Active" / "Inactive" — field name unconfirmed, read defensively. */
  registrationStatus?: string;
  companyName?: string;
  raw: Record<string, unknown>;
}

/**
 * Confirmed against a real sandbox response: Smile ID's Basic/Enhanced KYC
 * puts per-check verdicts in an `Actions` map (e.g. `Verify_ID_Number`,
 * `Return_Personal_Info`) — but when the underlying check never actually ran
 * (e.g. the product isn't enabled on the account yet), those values come
 * back as "Not Done", not a real verdict:
 *
 *   { "ResultCode": "1016",
 *     "ResultText": "Unable to validate ID - This feature is not enabled...",
 *     "Actions": { "Verify_ID_Number": "Not Done", "Return_Personal_Info": "Not Done" } }
 *
 * There is no confirmed success-case example yet (blocked on the account's
 * product not being enabled), so this deliberately does NOT guess at a
 * "success" ResultCode — an earlier version treated any code starting with
 * "101" as success, which incorrectly matched this exact failure code
 * ("1016"). Unmatched/ambiguous responses (including "Not Done") now default
 * to MANUAL_REVIEW rather than VERIFIED — a false "needs review" is a UX
 * inconvenience, a false "verified" is a compliance failure.
 */
function readActionVerdict(raw: Record<string, unknown>): SmileIdMatchStatus {
  const actions = raw.Actions as Record<string, string> | undefined;
  const verdicts = actions ? Object.values(actions) : [];

  if (verdicts.some((v) => /not verified|failed/i.test(v))) return 'FAILED';
  if (verdicts.some((v) => /review/i.test(v))) return 'MANUAL_REVIEW';
  // Confirmed against a real sandbox success (ResultCode 1012): every action
  // reads "Verified" or "Returned" (Return_Personal_Info). "Not Done" /
  // "Not Returned" still fall through to MANUAL_REVIEW below.
  if (verdicts.length > 0 && verdicts.every((v) => /^(verified|returned)$/i.test(v.trim()))) return 'VERIFIED';

  return 'MANUAL_REVIEW';
}

/**
 * Enhanced KYC accounts get the ID authority's registered name back in the
 * response (field name not yet confirmed against a real account — checks a
 * few likely candidates defensively). Falls back to undefined so callers can
 * use the user-submitted name instead.
 */
function readMatchedName(raw: Record<string, unknown>): string | undefined {
  if (typeof raw.FullName === 'string') return raw.FullName;

  const firstName = raw.FirstName ?? raw.first_name;
  const lastName = raw.LastName ?? raw.last_name;
  if (typeof firstName === 'string' && typeof lastName === 'string') {
    return `${firstName} ${lastName}`.trim();
  }

  return undefined;
}

/**
 * Business Verification's `company_information` shape isn't confirmed
 * against a real account (docs blocked scripted access) — read defensively,
 * to be tightened once a real sandbox response is available.
 */
function readCompanyInfo(raw: Record<string, unknown>): { status?: string; name?: string } {
  const info = raw.company_information as Record<string, unknown> | undefined;
  const status = (info?.status ?? raw.RegistrationStatus) as string | undefined;
  const name = (info?.name ?? info?.company_name ?? raw.CompanyName) as string | undefined;
  return { status, name };
}

// The SDK throws axios errors whose real reason lives in `error.response.data`
// — SmileIdApiError only surfaced `error.message` ("Request failed with status
// code 400"), which is useless for debugging a rejected submission. Mirrors
// monnify.service.ts's toMonnifyError so both providers log the same way.
function logSmileIdError(error: unknown, context: string) {
  const err = error as { response?: { status?: number; data?: unknown }; message?: string };
  console.error('❌ Smile ID API Error:', {
    context,
    status: err?.response?.status,
    data: err?.response?.data,
    message: err?.message,
  });
}

export class SmileIdService {
  private idApi = new IDApi(PARTNER_ID, API_KEY, SID_SERVER);
  private webApi = new WebApi(PARTNER_ID, CALLBACK_URL, API_KEY, SID_SERVER);

  async verifyId(input: SmileIdIdCheckInput): Promise<SmileIdIdCheckResult> {
    try {
      const raw = await this.idApi.submit_job<Record<string, unknown>>(
        { user_id: input.userId, job_id: input.jobId, job_type: JOB_TYPE.BASIC_KYC },
        {
          first_name: input.firstName,
          last_name: input.lastName,
          country: 'NG',
          // Smile ID deprecated the plain 'NIN' id_type; NIN lookups must use 'NIN_V2'.
          id_type: input.idType === 'NIN' ? 'NIN_V2' : input.idType,
          id_number: input.idNumber,
          dob: input.dob,
          phone_number: input.phoneNumber,
        }
      );

      return { status: readActionVerdict(raw), matchedName: readMatchedName(raw), raw };
    } catch (error) {
      logSmileIdError(error, `verifyId/${input.idType}`);
      throw new SmileIdApiError(
        error instanceof Error ? error.message : `Smile ID ${input.idType} verification failed`,
        error
      );
    }
  }

  /**
   * CAC (Corporate Affairs Commission) business registration lookup —
   * job_type BUSINESS_VERIFICATION, submitted through the same IDApi path
   * used for BVN/NIN (confirmed compatible from the SDK's own source).
   * Confirmed live: `id_number` must be numbers-only, no "RC"/"BN"/"IT"
   * prefix (e.g. "RC1234567" → "1234567") — a prefixed number is rejected.
   */
  async verifyBusiness(input: SmileIdBusinessCheckInput): Promise<SmileIdBusinessCheckResult> {
    try {
      const numericId = input.registrationNumber.replace(/^[A-Za-z]+/, '');
      const raw = await this.idApi.submit_job<Record<string, unknown>>(
        { user_id: input.userId, job_id: input.jobId, job_type: JOB_TYPE.BUSINESS_VERIFICATION },
        {
          business_type: input.businessType,
          country: 'NG',
          id_type: 'BUSINESS_REGISTRATION',
          id_number: numericId,
        }
      );

      const { status, name } = readCompanyInfo(raw);

      return {
        status: readActionVerdict(raw),
        registrationStatus: status,
        companyName: name,
        raw,
      };
    } catch (error) {
      logSmileIdError(error, 'verifyBusiness');
      throw new SmileIdApiError(
        error instanceof Error ? error.message : 'Smile ID business verification failed',
        error
      );
    }
  }

  async verifyFace(input: SmileIdFaceCheckInput): Promise<SmileIdFaceCheckResult> {
    try {
      const response = (await this.webApi.submit_job(
        { user_id: input.userId, job_id: input.jobId, job_type: JOB_TYPE.BIOMETRIC_KYC },
        [{ image_type_id: IMAGE_TYPE.SELFIE_IMAGE_BASE64, image: input.selfieImageBase64 }],
        {
          entered: 'true',
          country: 'NG',
          id_type: 'BVN',
          id_number: input.bvn,
        },
        { return_job_status: true }
      )) as Record<string, unknown>;

      // Confirmed against a real response: with return_job_status:true, the
      // actual Actions/ResultCode payload is nested one level deeper under
      // `result` — { code, job_complete, job_success, result: { Actions, ... } }
      // — not at the top level like the BVN/NIN (IDApi) responses.
      const raw = (response.result as Record<string, unknown> | undefined) ?? response;

      const confidence = Number(raw.ConfidenceValue ?? raw.confidence ?? NaN);
      let status = readActionVerdict(raw);

      // job_success is an explicit top-level boolean when present — trust a
      // hard `false` even if the Actions text didn't match any known phrase.
      if (response.job_success === false && status !== 'FAILED') {
        status = 'MANUAL_REVIEW';
      }

      return { status, confidence: Number.isFinite(confidence) ? confidence : undefined, raw };
    } catch (error) {
      logSmileIdError(error, 'verifyFace');
      throw new SmileIdApiError(
        error instanceof Error ? error.message : 'Smile ID face verification failed',
        error
      );
    }
  }
}

export const smileIdService = new SmileIdService();
