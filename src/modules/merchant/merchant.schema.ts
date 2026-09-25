import { z } from 'zod';
import { ALL_MCC_CATEGORIES } from '../../config/restricted-mcc.js';

// ─────────────────────────────────────────────
// ENUMS MAPPING (Strictly matching Prisma Enums)
// ─────────────────────────────────────────────
const BusinessTypeEnum = z.enum([
  'INDIVIDUAL_TRADER',
  'SOLE_PROPRIETORSHIP',
  'PARTNERSHIP',
  'LIMITED_LIABILITY',
  'INCORPORATED_TRUSTEES',
]);
const KycStatusEnum = z.enum(['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED']);
const MccCategoryEnum = z.enum(ALL_MCC_CATEGORIES);

// ─────────────────────────────────────────────
// GATED KYC ONBOARDING: STEP 1 (BVN) → STEP 2 (FACE) → STEP 3 (NIN)
// ─────────────────────────────────────────────
export const kycBvnSchema = z.object({
  bvn: z.string()
    .length(11, { message: "BVN must be exactly 11 digits" })
    .regex(/^[0-9]+$/, { message: "BVN must contain only numbers" }),
  ownerName: z.string().min(2, { message: "Owner name is required" }),
  ownerDob: z.string().datetime({ message: "Invalid Date of Birth format (ISO string required)" }),
  mobile: z.string().regex(/^(?:\+234|234|0)[789][01]\d{8}$/, {
    message: "Invalid Nigerian mobile number format. Use 080... or +234..."
  }),
  // Must be explicitly checked to proceed — NIBSS iGree consent requirement.
  consent: z.literal(true, { errorMap: () => ({ message: "Consent to BVN verification is required" }) }),
});

export const kycFaceSchema = z.object({
  // Base64-encoded selfie image (data URL prefix optional) — no multipart
  // upload plumbing in this project yet, so plain JSON body is used.
  selfieImage: z.string().min(100, { message: "A selfie image is required" }),
});

export const kycFaceLinkSchema = z.object({
  // Browser origin the merchant is on; must be one of CORS_ORIGIN (checked in the service).
  origin: z.string().url().optional(),
});

export const faceLinkTokenParamsSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{48}$/, { message: 'Invalid link' }),
});

export const kycNinSchema = z.object({
  nin: z.string()
    .length(11, { message: "NIN must be exactly 11 digits" })
    .regex(/^[0-9]+$/, { message: "NIN must contain only numbers" }),
});

// ─────────────────────────────────────────────
// GATED KYC ONBOARDING: STEP 4 (BUSINESS) → STEP 5 (ADDRESS) →
// STEP 6 (KYB) → STEP 7 (BANK) → STEP 9 (DECISION)
// ─────────────────────────────────────────────
export const kycBusinessSchema = z.object({
  businessName: z.string().min(2, { message: "Business name must be at least 2 characters" }).max(100),
  businessType: BusinessTypeEnum,
  tradeName: z.string().min(2).max(100).optional(),
  mccCategory: MccCategoryEnum,
  description: z.string().max(500).optional(),
  expectedMonthlyVolume: z.number().positive({ message: "Expected monthly volume must be positive" }),
  socialHandles: z.record(z.string()).optional(),
});

export const kycAddressSchema = z.object({
  addressLine1: z.string().min(5, { message: "Valid address is required" }),
  addressLine2: z.string().optional(),
  addressCity: z.string().min(2),
  addressState: z.string().min(2), // e.g., "Lagos", "Abuja"
  addressLga: z.string().min(2, { message: "LGA is required" }),
  addressCountry: z.string().default("Nigeria"),
  // Required for Tier 2/3 (anything but INDIVIDUAL_TRADER) — enforced in the
  // service layer since it depends on the merchant's businessType, not on
  // this body alone. Base64 image — see Phase 2 plan note on storage gap.
  proofOfAddressImage: z.string().optional(),
});

export const kycKybSchema = z.object({
  cacNumber: z.string().min(3, { message: "Invalid CAC number format" }).optional(),
  tin: z.string().min(3, { message: "TIN is required" }).optional(),
  scumlNumber: z.string().optional(),
  sectorLicenseNumber: z.string().optional(),
  directors: z.array(z.object({
    fullName: z.string().min(2),
    personRole: z.enum(['DIRECTOR', 'SHAREHOLDER_UBO']),
    bvn: z.string().length(11).regex(/^[0-9]+$/),
    nin: z.string().length(11).regex(/^[0-9]+$/),
    ownershipPercent: z.number().min(0).max(100).optional(),
  })).optional(),
});

export const kycBankSchema = z.object({
  // Monnify's own bank list (GET /merchant/getBanks) returns codes of varying
  // length — commercial banks are 3 digits, but most microfinance/fintech/
  // mobile-money banks are 5-6 digits (e.g. "090134", "110072") — so this
  // can't hard-require exactly 3 without rejecting the majority of real banks.
  bankCode: z.string().min(3).max(6).regex(/^[0-9]+$/, { message: "Bank code must be numeric" }),
  accountNumber: z.string().length(10, { message: "NUBAN Account number must be exactly 10 digits" }),
  accountName: z.string().min(2, { message: "Account name is required" }),
});

export const kycDecisionSchema = z.object({
  termsAccepted: z.literal(true, { errorMap: () => ({ message: "Terms & Conditions must be accepted" }) }),
  privacyConsentAccepted: z.literal(true, { errorMap: () => ({ message: "NDPA privacy consent must be accepted" }) }),
});

// ─────────────────────────────────────────────
// NIBSS / THIRD-PARTY KYC CALLBACK VALIDATION
// ─────────────────────────────────────────────
export const nibssCallbackSchema = z.object({
  merchantId: z.string().uuid({ message: "Invalid Merchant ID" }),
  nibssId: z.string().min(1, { message: "NIBSS ID is required" }),
  status: KycStatusEnum,
  rejectionReason: z.string().optional(),
});

export type KycBvnInput = z.infer<typeof kycBvnSchema>;
export type KycFaceInput = z.infer<typeof kycFaceSchema>;
export type KycFaceLinkInput = z.infer<typeof kycFaceLinkSchema>;
export type KycNinInput = z.infer<typeof kycNinSchema>;
export type KycBusinessInput = z.infer<typeof kycBusinessSchema>;
export type KycAddressInput = z.infer<typeof kycAddressSchema>;
export type KycKybInput = z.infer<typeof kycKybSchema>;
export type KycBankInput = z.infer<typeof kycBankSchema>;
export type KycDecisionInput = z.infer<typeof kycDecisionSchema>;
export type NibssCallbackInput = z.infer<typeof nibssCallbackSchema>;
