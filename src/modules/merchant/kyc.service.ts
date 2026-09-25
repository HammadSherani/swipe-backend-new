import { randomBytes } from 'crypto';
import QRCode from 'qrcode';
import { prisma } from '../../config/database.js';
import { redis } from '../../config/redis.js';
import { env } from '../../config/env.js';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../errors/custom-errors.js';
import { MerchantService } from './merchant.service.js';
import { CheckStatus, Prisma } from '../../generated/client/index.js';
import {
  KycBvnInput,
  KycFaceInput,
  KycNinInput,
  KycBusinessInput,
  KycAddressInput,
  KycKybInput,
  KycBankInput,
  KycDecisionInput,
} from './merchant.schema.js';
import { smileIdService, SmileIdMatchStatus, SmileIdBusinessType } from '../../services/smile-id.service.js';
import { monnifyService } from '../../services/monnify.service.js';
import { namesLooselyMatch } from '../../utils/name-match.js';
import { isRestrictedMcc, requiresScuml } from '../../config/restricted-mcc.js';
import { cloudinaryService } from '../../services/cloudinary.service.js';

const MAX_ATTEMPTS = 3;
const FACE_VERIFIED_THRESHOLD = 85;
const FACE_REVIEW_THRESHOLD = 60;

function toCheckStatus(matchStatus: SmileIdMatchStatus): CheckStatus {
  if (matchStatus === 'VERIFIED') return 'VERIFIED';
  if (matchStatus === 'MANUAL_REVIEW') return 'MANUAL_REVIEW';
  return 'FAILED';
}

// Face/liveness is only required for the individual actually opening the
// account (B2C-style INDIVIDUAL_TRADER). For every CAC-registered business
// type, the person completing onboarding is often a compliance/ops agent —
// not the BVN owner — so face-matching them would fail even though the
// onboarding is legitimate. Those business types already get independently
// verified via CAC/TIN/certificate of incorporation at the KYB step, which
// is a strong enough identity layer for the business itself.
function faceRequired(businessType: string): boolean {
  return businessType === 'INDIVIDUAL_TRADER';
}

// Maps our BusinessType enum to Smile ID's Nigeria Business Registration
// codes (confirmed live: only 'bn'/'co'/'it' are accepted).
function toSmileIdBusinessType(businessType: string): SmileIdBusinessType {
  if (businessType === 'LIMITED_LIABILITY') return 'co';
  if (businessType === 'INCORPORATED_TRUSTEES') return 'it';
  return 'bn'; // SOLE_PROPRIETORSHIP, PARTNERSHIP
}

export class KycService {
  private async getMerchant(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundError('Account not found. Please register first.');
    }

    // Enforced here (not just in the UI) so no KYC endpoint can be reached by an
    // account whose email/mobile OTP verification isn't complete.
    if (!user.isVerified || !user.isActive) {
      throw new ForbiddenError('Please verify your email and mobile number before starting KYC.', 'VERIFICATION_REQUIRED');
    }

    // Self-heal a MERCHANT user whose baseline Merchant row is missing (e.g. it
    // was removed) instead of dead-ending the onboarding wizard with a 404.
    const merchant = await prisma.merchant.findUnique({ where: { userId } })
      ?? (user.role === 'MERCHANT'
        ? await new MerchantService().initializeProfile(user.id, user.email, user.mobile)
        : null);

    if (!merchant) {
      throw new NotFoundError('Merchant profile not found for this account.');
    }
    return merchant;
  }

  private async audit(
    merchantId: string,
    step: 'BVN' | 'FACE' | 'NIN' | 'BUSINESS' | 'ADDRESS' | 'KYB' | 'BANK' | 'DECISION',
    action: 'CONSENT_CAPTURED' | 'ATTEMPT' | 'PASS' | 'FAIL' | 'SOFT_BLOCK',
    result?: string,
    ipAddress?: string,
    metadata?: Record<string, unknown>
  ) {
    await prisma.kycAuditLog.create({
      data: { merchantId, step, action, result, ipAddress, metadata: metadata as Prisma.InputJsonValue },
    });
  }

  // ========== STEP 2: BVN (Business Info is now Step 1) ==========
  async verifyBvnStep(userId: string, data: KycBvnInput, ip?: string) {
    const merchant = await this.getMerchant(userId);

    if (!merchant.mccCategory) {
      throw new BadRequestError('Complete business info first', 'STEP_LOCKED');
    }

    if (merchant.bvnStatus !== 'VERIFIED' && merchant.bvnAttempts >= MAX_ATTEMPTS) {
      throw new BadRequestError(
        'Too many BVN verification attempts. Please contact support.',
        'BVN_SOFT_BLOCKED'
      );
    }

    const bvnExists = await prisma.merchant.findFirst({
      where: { bvn: data.bvn, NOT: { userId } },
    });
    if (bvnExists) {
      throw new BadRequestError('BVN already linked to another merchant account', 'BVN_ALREADY_LINKED');
    }

    // Consent is captured on every submission regardless of outcome (NIBSS iGree requirement).
    await prisma.merchant.update({
      where: { id: merchant.id },
      data: { bvnConsentAt: new Date(), bvnConsentIp: ip },
    });
    await this.audit(merchant.id, 'BVN', 'CONSENT_CAPTURED', undefined, ip);

    // Cache: unchanged input + already verified — skip re-calling the provider
    // (handles the user navigating back/forward without editing anything).
    if (
      merchant.bvnStatus === 'VERIFIED' &&
      merchant.bvn === data.bvn &&
      merchant.ownerName === data.ownerName &&
      merchant.ownerDob?.toISOString().slice(0, 10) === data.ownerDob.slice(0, 10)
    ) {
      return { success: true, message: 'BVN already verified', bvnStatus: merchant.bvnStatus, cached: true };
    }

    let matchStatus: SmileIdMatchStatus;
    let matchedName: string | undefined;

    if (env.KYC_VERIFICATION_MODE === 'static') {
      console.log(`🪪 [DEV] Skipping live Smile ID BVN verification for ${data.bvn} (KYC_VERIFICATION_MODE=static)`);
      matchStatus = 'VERIFIED';
    } else {
      const [firstName, ...rest] = data.ownerName.trim().split(/\s+/);
      const result = await smileIdService.verifyId({
        idNumber: data.bvn,
        idType: 'BVN',
        firstName: firstName ?? data.ownerName,
        lastName: rest.join(' ') || data.ownerName,
        dob: data.ownerDob.slice(0, 10),
        phoneNumber: data.mobile,
        userId,
        jobId: `bvn-${merchant.id}-${Date.now()}`,
      });
      matchStatus = result.status;
      matchedName = result.matchedName;
    }

    // Fuzzy name check on top of the provider's own verdict — a provider
    // "verified" result still gets rejected if the submitted name is wildly
    // different from what it matched against.
    if (matchStatus === 'VERIFIED' && matchedName && !namesLooselyMatch(data.ownerName, matchedName)) {
      matchStatus = 'MANUAL_REVIEW';
    }

    if (matchStatus === 'FAILED') {
      const attemptsNow = merchant.bvnAttempts + 1;
      await prisma.merchant.update({ where: { id: merchant.id }, data: { bvnAttempts: attemptsNow } });
      await this.audit(merchant.id, 'BVN', 'FAIL', matchStatus);

      if (attemptsNow >= MAX_ATTEMPTS) {
        await this.audit(merchant.id, 'BVN', 'SOFT_BLOCK');
        throw new BadRequestError(
          'BVN verification failed 3 times. Please contact support.',
          'BVN_SOFT_BLOCKED'
        );
      }

      throw new BadRequestError(
        `BVN verification failed (${MAX_ATTEMPTS - attemptsNow} attempt(s) remaining)`,
        'BVN_MISMATCH'
      );
    }

    const bvnStatus = toCheckStatus(matchStatus);
    // Business type is already known (Step 1), so decide right now whether
    // Face is even needed — skip it immediately for CAC-registered types.
    const skipFace = bvnStatus === 'VERIFIED' && !faceRequired(merchant.businessType);

    await prisma.merchant.update({
      where: { id: merchant.id },
      data: {
        bvn: data.bvn,
        ownerName: data.ownerName,
        ownerDob: new Date(data.ownerDob),
        bvnStatus,
        verifiedName: matchedName ?? data.ownerName,
        ...(skipFace ? { faceMatchStatus: 'VERIFIED' as CheckStatus } : {}),
      },
    });

    await this.audit(merchant.id, 'BVN', bvnStatus === 'VERIFIED' ? 'PASS' : 'ATTEMPT', bvnStatus);

    if (skipFace) {
      await this.audit(merchant.id, 'FACE', 'PASS', 'SKIPPED_NOT_REQUIRED_FOR_BUSINESS_TYPE');
    }

    return {
      success: true,
      message: bvnStatus === 'VERIFIED' ? 'BVN verified successfully' : 'BVN submitted for manual review',
      bvnStatus,
    };
  }

  // ========== STEP 3: FACE / LIVENESS (skipped for CAC-registered business types) ==========
  async verifyFaceStep(userId: string, data: KycFaceInput, ip?: string) {
    const merchant = await this.getMerchant(userId);

    if (merchant.bvnStatus !== 'VERIFIED') {
      throw new BadRequestError('Complete BVN verification first', 'STEP_LOCKED');
    }

    if (merchant.faceMatchStatus === 'VERIFIED') {
      return {
        success: true,
        message: faceRequired(merchant.businessType)
          ? 'Face already verified'
          : 'Face verification not required for this business type',
        faceMatchStatus: merchant.faceMatchStatus,
        cached: true,
      };
    }

    if (merchant.faceAttempts >= MAX_ATTEMPTS) {
      throw new BadRequestError(
        'Too many face verification attempts. Please contact support.',
        'FACE_SOFT_BLOCKED'
      );
    }

    let status: CheckStatus;
    let confidence: number | undefined;

    if (env.KYC_VERIFICATION_MODE === 'static') {
      console.log(`🪪 [DEV] Skipping live Smile ID face verification for merchant ${merchant.id} (KYC_VERIFICATION_MODE=static)`);
      status = 'VERIFIED';
      confidence = 100;
    } else {
      const result = await smileIdService.verifyFace({
        selfieImageBase64: data.selfieImage,
        bvn: merchant.bvn!,
        userId,
        jobId: `face-${merchant.id}-${Date.now()}`,
      });
      confidence = result.confidence;

      if (confidence !== undefined) {
        status = confidence >= FACE_VERIFIED_THRESHOLD
          ? 'VERIFIED'
          : confidence >= FACE_REVIEW_THRESHOLD
            ? 'MANUAL_REVIEW'
            : 'FAILED';
      } else {
        status = toCheckStatus(result.status);
      }
    }

    // A selfie that doesn't match is not a hard failure: it goes to manual review
    // so the merchant can continue and the admin decides, seeing the "Face — needs
    // review" badge. No attempt counting / lockout for the face step.
    if (status === 'FAILED') {
      status = 'MANUAL_REVIEW';
    }

    await prisma.merchant.update({
      where: { id: merchant.id },
      data: { faceMatchStatus: status, faceMatchConfidence: confidence },
    });

    await this.audit(merchant.id, 'FACE', status === 'VERIFIED' ? 'PASS' : 'ATTEMPT', status);

    return {
      success: true,
      message: status === 'VERIFIED' ? 'Face verified successfully' : 'Face verification submitted for manual review',
      faceMatchStatus: status,
      confidence,
    };
  }

  // ========== STEP 3 (alt): FACE VIA PHONE LINK ==========
  // Lets a merchant without a laptop camera take the selfie on their phone.
  // The link carries an unguessable one-time token (10 min) that maps to this
  // merchant in Redis and can only be used for the face step.
  private faceLinkKey(token: string) {
    return `facelink:${token}`;
  }

  async createFaceLink(userId: string, origin?: string) {
    const merchant = await this.getMerchant(userId);

    if (merchant.bvnStatus !== 'VERIFIED') {
      throw new BadRequestError('Complete BVN verification first', 'STEP_LOCKED');
    }
    if (merchant.faceMatchStatus === 'VERIFIED') {
      throw new BadRequestError('Face is already verified', 'ALREADY_VERIFIED');
    }

    const allowed = env.CORS_ORIGIN.split(',').map((o) => o.trim());
    const base = (env.FRONTEND_PUBLIC_URL || (origin && allowed.includes(origin) ? origin : allowed[0])).replace(/\/+$/, '');

    const token = randomBytes(24).toString('hex');
    await redis.set(this.faceLinkKey(token), userId, 'EX', 600);

    const url = `${base}/kyc/selfie/${token}`;
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 240 });

    return { token, url, qrDataUrl, expiresIn: 600 };
  }

  private async userIdForFaceLink(token: string): Promise<string> {
    const userId = await redis.get(this.faceLinkKey(token));
    if (!userId) {
      throw new NotFoundError('This link has expired. Please generate a new one on your computer.');
    }
    return userId;
  }

  async checkFaceLink(token: string) {
    await this.userIdForFaceLink(token);
    return { valid: true };
  }

  async submitFaceViaLink(token: string, data: KycFaceInput, ip?: string) {
    const userId = await this.userIdForFaceLink(token);
    const result = await this.verifyFaceStep(userId, data, ip);
    if (result.faceMatchStatus === 'VERIFIED') {
      await redis.del(this.faceLinkKey(token));
    }
    return result;
  }

  // ========== STEP 4: NIN ==========
  async verifyNinStep(userId: string, data: KycNinInput) {
    const merchant = await this.getMerchant(userId);

    // A face result parked in MANUAL_REVIEW counts as done — the admin reviews it.
    if (merchant.faceMatchStatus !== 'VERIFIED' && merchant.faceMatchStatus !== 'MANUAL_REVIEW') {
      throw new BadRequestError('Complete face verification first', 'STEP_LOCKED');
    }

    if (merchant.ninStatus !== 'VERIFIED' && merchant.ninAttempts >= MAX_ATTEMPTS) {
      throw new BadRequestError(
        'Too many NIN verification attempts. Please contact support.',
        'NIN_SOFT_BLOCKED'
      );
    }

    const ninExists = await prisma.merchant.findFirst({
      where: { nin: data.nin, NOT: { userId } },
    });
    if (ninExists) {
      throw new BadRequestError('NIN already linked to another merchant account', 'NIN_ALREADY_LINKED');
    }

    let matchStatus: SmileIdMatchStatus;

    if (env.KYC_VERIFICATION_MODE === 'static') {
      console.log(`🪪 [DEV] Skipping live Smile ID NIN verification for ${data.nin} (KYC_VERIFICATION_MODE=static)`);
      matchStatus = 'VERIFIED';
    } else {
      // Cross-check against the BVN-verified name/DOB (source of truth from
      // Step 1 onward), not any raw user-typed value at this step.
      const name = merchant.verifiedName ?? merchant.ownerName;
      const [firstName, ...rest] = name.trim().split(/\s+/);
      const result = await smileIdService.verifyId({
        idNumber: data.nin,
        idType: 'NIN',
        firstName: firstName ?? name,
        lastName: rest.join(' ') || name,
        dob: merchant.ownerDob ? merchant.ownerDob.toISOString().slice(0, 10) : '',
        phoneNumber: merchant.mobile,
        userId,
        jobId: `nin-${merchant.id}-${Date.now()}`,
      });
      matchStatus = result.status;
    }

    if (matchStatus === 'FAILED') {
      const attemptsNow = merchant.ninAttempts + 1;
      await prisma.merchant.update({ where: { id: merchant.id }, data: { ninAttempts: attemptsNow } });
      await this.audit(merchant.id, 'NIN', 'FAIL', matchStatus);

      if (attemptsNow >= MAX_ATTEMPTS) {
        await this.audit(merchant.id, 'NIN', 'SOFT_BLOCK');
        throw new BadRequestError(
          'NIN verification failed 3 times. Please contact support.',
          'NIN_SOFT_BLOCKED'
        );
      }

      throw new BadRequestError(
        `NIN verification failed (${MAX_ATTEMPTS - attemptsNow} attempt(s) remaining)`,
        'NIN_MISMATCH'
      );
    }

    const ninStatus = toCheckStatus(matchStatus);

    await prisma.merchant.update({
      where: { id: merchant.id },
      data: {
        nin: data.nin,
        ninStatus,
        // BVN + NIN both linked and verified — bump the merchant to Tier 2.
        kycLevel: ninStatus === 'VERIFIED' && merchant.bvnStatus === 'VERIFIED' ? 'TIER_2' : undefined,
      },
    });

    await this.audit(merchant.id, 'NIN', ninStatus === 'VERIFIED' ? 'PASS' : 'ATTEMPT', ninStatus);

    return {
      success: true,
      message: ninStatus === 'VERIFIED' ? 'NIN verified successfully' : 'NIN submitted for manual review',
      ninStatus,
    };
  }

  // ========== STEP 1: BUSINESS INFO (first step — decides whether Face is required) ==========
  async submitBusinessInfoStep(userId: string, data: KycBusinessInput) {
    const merchant = await this.getMerchant(userId);

    if (isRestrictedMcc(data.mccCategory)) {
      throw new BadRequestError(
        `Business category "${data.mccCategory}" is not eligible for onboarding`,
        'MCC_PROHIBITED'
      );
    }

    // businessType can still be edited before later steps lock it in — if it
    // changes after BVN is already verified, recompute whether Face is now
    // required instead of leaving a stale faceMatchStatus behind.
    let faceMatchStatus: CheckStatus | undefined;
    if (merchant.bvnStatus === 'VERIFIED' && merchant.businessType !== data.businessType) {
      faceMatchStatus = faceRequired(data.businessType) ? 'PENDING' : 'VERIFIED';
    }

    await prisma.merchant.update({
      where: { id: merchant.id },
      data: {
        businessName: data.businessName,
        businessType: data.businessType,
        tradeName: data.tradeName ?? null,
        mccCategory: data.mccCategory,
        description: data.description ?? null,
        expectedMonthlyVolume: data.expectedMonthlyVolume,
        socialHandles: (data.socialHandles ?? null) as Prisma.InputJsonValue,
        ...(faceMatchStatus ? { faceMatchStatus } : {}),
      },
    });

    await this.audit(merchant.id, 'BUSINESS', 'PASS');

    return { success: true, message: 'Business info saved' };
  }

  // ========== STEP 5: ADDRESS ==========
  async submitAddressStep(userId: string, data: KycAddressInput) {
    const merchant = await this.getMerchant(userId);

    if (!merchant.mccCategory) {
      throw new BadRequestError('Complete business info first', 'STEP_LOCKED');
    }

    if (merchant.businessType !== 'INDIVIDUAL_TRADER' && !data.proofOfAddressImage) {
      throw new BadRequestError(
        'Proof of address is required for this business type',
        'ADDRESS_PROOF_REQUIRED'
      );
    }

    const addressProofUrl = data.proofOfAddressImage
      ? await cloudinaryService.uploadBase64Image(data.proofOfAddressImage, 'kyc/proof-of-address')
      : null;

    await prisma.merchant.update({
      where: { id: merchant.id },
      data: {
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2 ?? null,
        addressCity: data.addressCity,
        addressState: data.addressState,
        addressLga: data.addressLga,
        addressCountry: data.addressCountry,
        addressProofSubmittedAt: data.proofOfAddressImage ? new Date() : null,
        addressProofUrl,
      },
    });

    await this.audit(merchant.id, 'ADDRESS', 'PASS');

    return { success: true, message: 'Address saved' };
  }

  // ========== STEP 6: KYB (skipped entirely for INDIVIDUAL_TRADER) ==========
  async submitKybStep(userId: string, data: KycKybInput) {
    const merchant = await this.getMerchant(userId);

    if (!merchant.addressLga) {
      throw new BadRequestError('Complete address step first', 'STEP_LOCKED');
    }

    if (merchant.businessType === 'INDIVIDUAL_TRADER') {
      await prisma.merchant.update({ where: { id: merchant.id }, data: { cacStatus: 'VERIFIED' } });
      await this.audit(merchant.id, 'KYB', 'PASS', 'SKIPPED_INDIVIDUAL_TRADER');
      return { success: true, message: 'KYB not required for individual traders', cacStatus: 'VERIFIED' as CheckStatus };
    }

    if (!data.cacNumber) {
      throw new BadRequestError('CAC number is required for registered businesses', 'CAC_REQUIRED');
    }

    const requiresDirectors = merchant.businessType === 'PARTNERSHIP' || merchant.businessType === 'LIMITED_LIABILITY';

    if (requiresDirectors) {
      if (!data.tin) {
        throw new BadRequestError('TIN is required for this business type', 'TIN_REQUIRED');
      }
      if (requiresScuml(merchant.mccCategory ?? '') && !data.scumlNumber) {
        throw new BadRequestError('SCUML number is required for this business category', 'SCUML_REQUIRED');
      }
      if (!data.directors || data.directors.length === 0) {
        throw new BadRequestError(
          'At least one director/shareholder is required for this business type',
          'DIRECTORS_REQUIRED'
        );
      }
    }

    let cacStatus: CheckStatus;
    let registrationStatus: string | undefined;

    if (env.KYC_VERIFICATION_MODE === 'static') {
      console.log(`🪪 [DEV] Skipping live Smile ID CAC verification for ${data.cacNumber} (KYC_VERIFICATION_MODE=static)`);
      cacStatus = 'VERIFIED';
      registrationStatus = 'Active';
    } else {
      const result = await smileIdService.verifyBusiness({
        registrationNumber: data.cacNumber,
        businessType: toSmileIdBusinessType(merchant.businessType),
        userId,
        jobId: `cac-${merchant.id}-${Date.now()}`,
      });
      registrationStatus = result.registrationStatus;
      const nameMatches = result.companyName ? namesLooselyMatch(merchant.businessName, result.companyName) : true;
      cacStatus =
        result.status === 'VERIFIED' && registrationStatus?.toLowerCase() === 'active' && nameMatches
          ? 'VERIFIED'
          : result.status === 'FAILED'
            ? 'FAILED'
            : 'MANUAL_REVIEW';
    }

    await prisma.merchant.update({
      where: { id: merchant.id },
      data: {
        cacNumber: data.cacNumber,
        tin: data.tin ?? null,
        scumlNumber: data.scumlNumber ?? null,
        sectorLicenseNumber: data.sectorLicenseNumber ?? null,
        cacStatus,
        cacVerifiedStatus: registrationStatus ?? null,
      },
    });

    if (requiresDirectors && data.directors) {
      for (const director of data.directors) {
        const existingPerson = await prisma.merchantPerson.findFirst({
          where: { merchantId: merchant.id, bvn: director.bvn },
        });
        if (existingPerson) continue; // already recorded in a previous submission

        let personBvnStatus: CheckStatus = 'VERIFIED';
        let personNinStatus: CheckStatus = 'VERIFIED';

        if (env.KYC_VERIFICATION_MODE !== 'static') {
          const [firstName, ...rest] = director.fullName.trim().split(/\s+/);

          const bvnResult = await smileIdService.verifyId({
            idNumber: director.bvn,
            idType: 'BVN',
            firstName: firstName ?? director.fullName,
            lastName: rest.join(' ') || director.fullName,
            dob: '',
            phoneNumber: '',
            userId,
            jobId: `person-bvn-${merchant.id}-${Date.now()}-${director.bvn}`,
          });
          personBvnStatus = toCheckStatus(bvnResult.status);

          const ninResult = await smileIdService.verifyId({
            idNumber: director.nin,
            idType: 'NIN',
            firstName: firstName ?? director.fullName,
            lastName: rest.join(' ') || director.fullName,
            dob: '',
            phoneNumber: '',
            userId,
            jobId: `person-nin-${merchant.id}-${Date.now()}-${director.nin}`,
          });
          personNinStatus = toCheckStatus(ninResult.status);
        }

        await prisma.merchantPerson.create({
          data: {
            merchantId: merchant.id,
            personRole: director.personRole,
            fullName: director.fullName,
            bvn: director.bvn,
            nin: director.nin,
            ownershipPercent: director.ownershipPercent,
            bvnStatus: personBvnStatus,
            ninStatus: personNinStatus,
          },
        });
      }
    }

    await this.audit(merchant.id, 'KYB', cacStatus === 'VERIFIED' ? 'PASS' : 'ATTEMPT', cacStatus);

    return {
      success: true,
      message: cacStatus === 'VERIFIED' ? 'Business verified successfully' : 'Business submitted for manual review',
      cacStatus,
    };
  }

  // ========== STEP 7: SETTLEMENT BANK ==========
  async submitBankStep(userId: string, data: KycBankInput) {
    const merchant = await this.getMerchant(userId);

    if (merchant.cacStatus === 'PENDING') {
      throw new BadRequestError('Complete KYB step first', 'STEP_LOCKED');
    }

    const validated = await monnifyService.validateAccountNumber(data.accountNumber, data.bankCode);
    const nameMatches = namesLooselyMatch(data.accountName, validated.accountName);

    let nubanStatus: CheckStatus;

    if (!nameMatches) {
      // Hard block per spec — a name mismatch is routed to review, never
      // auto-approved regardless of tier.
      nubanStatus = 'MANUAL_REVIEW';
    } else if (env.KYC_VERIFICATION_MODE === 'static' || env.MONNIFY_BVN_MATCH === 'off') {
      console.log(`🪪 [DEV] Skipping Monnify BVN-account match for merchant ${merchant.id} (KYC_VERIFICATION_MODE=${env.KYC_VERIFICATION_MODE}, MONNIFY_BVN_MATCH=${env.MONNIFY_BVN_MATCH})`);
      nubanStatus = 'VERIFIED';
    } else {
      const matchStatus = await monnifyService.verifyBvnAccountMatch(merchant.bvn!, data.accountNumber, data.bankCode);
      nubanStatus = matchStatus === 'NO_MATCH' ? 'MANUAL_REVIEW' : 'VERIFIED';
    }

    await prisma.merchant.update({
      where: { id: merchant.id },
      data: {
        bankCode: data.bankCode,
        accountNumber: data.accountNumber,
        accountName: data.accountName,
        nubanStatus,
      },
    });

    await this.audit(merchant.id, 'BANK', nubanStatus === 'VERIFIED' ? 'PASS' : 'ATTEMPT', nubanStatus, undefined, {
      bankRecordName: validated.accountName,
    });

    return {
      success: true,
      message: nubanStatus === 'VERIFIED' ? 'Settlement account verified successfully' : 'Settlement account submitted for manual review',
      nubanStatus,
    };
  }

  // ========== STEP 9: FINAL DECISION ==========
  async submitForDecision(userId: string, _data: KycDecisionInput) {
    const merchant = await this.getMerchant(userId);

    if (merchant.nubanStatus === 'PENDING') {
      throw new BadRequestError('Complete settlement bank step first', 'STEP_LOCKED');
    }

    if (merchant.status === 'ACTIVE' || merchant.status === 'PENDING_REVIEW') {
      throw new BadRequestError('KYC already submitted for this merchant', 'ALREADY_SUBMITTED');
    }

    await prisma.merchant.update({
      where: { id: merchant.id },
      data: { termsAcceptedAt: new Date(), privacyConsentAcceptedAt: new Date() },
    });

    // Every merchant, whatever the business type or how many checks passed,
    // goes to an admin for a manual decision — the admin review screen shows
    // each check's result (BVN/NIN/Face/CAC/Bank) so the reviewer can see what
    // was verified. Nothing is auto-approved.
    await this.audit(merchant.id, 'DECISION', 'ATTEMPT', 'PENDING_REVIEW');

    await prisma.merchant.update({
      where: { id: merchant.id },
      data: { status: 'PENDING_REVIEW' },
    });

    return {
      success: true,
      message: 'Submitted for admin review',
      status: 'PENDING_REVIEW',
    };
  }

  // ========== STATUS (resume support) ==========
  async getKycStatus(userId: string) {
    const merchant = await this.getMerchant(userId);

    const nextStep =
      !merchant.mccCategory ? 'BUSINESS' :
      merchant.bvnStatus !== 'VERIFIED' ? 'BVN' :
      (merchant.faceMatchStatus !== 'VERIFIED' && merchant.faceMatchStatus !== 'MANUAL_REVIEW') ? 'FACE' :
      merchant.ninStatus !== 'VERIFIED' ? 'NIN' :
      !merchant.addressLga ? 'ADDRESS' :
      merchant.cacStatus === 'PENDING' ? 'KYB' :
      merchant.nubanStatus === 'PENDING' ? 'BANK' :
      (merchant.status === 'PENDING' || merchant.status === 'IN_PROGRESS') ? 'DECISION' :
      'DONE';

    return {
      bvnStatus: merchant.bvnStatus,
      bvnAttemptsRemaining: Math.max(0, MAX_ATTEMPTS - merchant.bvnAttempts),
      faceMatchStatus: merchant.faceMatchStatus,
      faceAttemptsRemaining: Math.max(0, MAX_ATTEMPTS - merchant.faceAttempts),
      faceRequired: merchant.mccCategory ? faceRequired(merchant.businessType) : undefined,
      ninStatus: merchant.ninStatus,
      ninAttemptsRemaining: Math.max(0, MAX_ATTEMPTS - merchant.ninAttempts),
      cacStatus: merchant.cacStatus,
      nubanStatus: merchant.nubanStatus,
      merchantStatus: merchant.status,
      nextStep,
      kycLevel: merchant.kycLevel,
    };
  }
}

export const kycService = new KycService();
