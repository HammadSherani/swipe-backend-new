import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  getMerchantHandler,
  nibssCallbackHandler,
  getBanksHandler,
} from './merchant.controller.js';
import {
  nibssCallbackSchema,
  kycBvnSchema,
  kycFaceSchema,
  kycFaceLinkSchema,
  faceLinkTokenParamsSchema,
  kycNinSchema,
  kycBusinessSchema,
  kycAddressSchema,
  kycKybSchema,
  kycBankSchema,
  kycDecisionSchema,
} from './merchant.schema.js';
import {
  kycBvnHandler,
  kycFaceHandler,
  kycFaceLinkCreateHandler,
  kycFaceLinkCheckHandler,
  kycFaceLinkSubmitHandler,
  kycNinHandler,
  kycStatusHandler,
  kycBusinessHandler,
  kycAddressHandler,
  kycKybHandler,
  kycBankHandler,
  kycSubmitHandler,
} from './kyc.controller.js';

export async function merchantRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Public — NIBSS webhook (no auth)
  app.post('/webhook/nibss', {
    schema: { tags: ['Merchants'], description: 'NIBSS KYC callback', body: nibssCallbackSchema },
    handler: nibssCallbackHandler,
  });

  app.get('/getBanks', {
    schema: { tags: ['Merchants'], description: 'List banks (Monnify)' },
    handler: getBanksHandler,
  });

  // Protected — JWT required

  // ── KYC onboarding: Business → BVN → Face (skipped for CAC-registered
  // business types) → NIN → Address → KYB → Bank → Decision ──
  app.post('/kyc/business', {
    schema: { tags: ['Merchant KYC'], description: 'Step 1: business info — decides whether Face verification is required', body: kycBusinessSchema },
    preHandler: fastify.authenticate,
    handler: kycBusinessHandler,
  });

  app.post('/kyc/bvn', {
    schema: { tags: ['Merchant KYC'], description: 'Step 2: verify BVN (requires business info)', body: kycBvnSchema },
    preHandler: fastify.authenticate,
    handler: kycBvnHandler,
  });

  app.post('/kyc/face', {
    schema: { tags: ['Merchant KYC'], description: 'Step 3: face/liveness verification — required only for INDIVIDUAL_TRADER, auto-skipped otherwise', body: kycFaceSchema },
    preHandler: fastify.authenticate,
    handler: kycFaceHandler,
  });

  app.post('/kyc/face/link', {
    schema: { tags: ['Merchant KYC'], description: 'Create a short-lived link/QR to take the selfie on a phone', body: kycFaceLinkSchema },
    preHandler: fastify.authenticate,
    handler: kycFaceLinkCreateHandler,
  });

  app.get('/kyc/face/link/:token', {
    schema: { tags: ['Merchant KYC'], description: 'Public: check a phone selfie link is still valid', params: faceLinkTokenParamsSchema },
    handler: kycFaceLinkCheckHandler,
  });

  app.post('/kyc/face/link/:token', {
    schema: { tags: ['Merchant KYC'], description: 'Public: submit the selfie taken on the phone', params: faceLinkTokenParamsSchema, body: kycFaceSchema },
    handler: kycFaceLinkSubmitHandler,
  });

  app.post('/kyc/nin', {
    schema: { tags: ['Merchant KYC'], description: 'Step 4: verify NIN (requires face verified/skipped)', body: kycNinSchema },
    preHandler: fastify.authenticate,
    handler: kycNinHandler,
  });

  app.get('/kyc/status', {
    schema: { tags: ['Merchant KYC'], description: 'Current KYC check statuses + unlocked step' },
    preHandler: fastify.authenticate,
    handler: kycStatusHandler,
  });

  app.post('/kyc/address', {
    schema: { tags: ['Merchant KYC'], description: 'Step 5: business address (requires business info)', body: kycAddressSchema },
    preHandler: fastify.authenticate,
    handler: kycAddressHandler,
  });

  app.post('/kyc/kyb', {
    schema: { tags: ['Merchant KYC'], description: 'Step 6: statutory/KYB — skipped for INDIVIDUAL_TRADER (requires address)', body: kycKybSchema },
    preHandler: fastify.authenticate,
    handler: kycKybHandler,
  });

  app.post('/kyc/bank', {
    schema: { tags: ['Merchant KYC'], description: 'Step 7: settlement bank (requires KYB)', body: kycBankSchema },
    preHandler: fastify.authenticate,
    handler: kycBankHandler,
  });

  app.post('/kyc/submit', {
    schema: { tags: ['Merchant KYC'], description: 'Step 9: final decision — auto-approve or admin review (requires bank step)', body: kycDecisionSchema },
    preHandler: fastify.authenticate,
    handler: kycSubmitHandler,
  });

  app.get('/me', {
    schema: { tags: ['Merchants'], description: 'Get my merchant details' },
    preHandler: fastify.authenticate,
    handler: getMerchantHandler,
  });
}
