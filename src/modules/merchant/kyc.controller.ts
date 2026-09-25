import { FastifyReply, FastifyRequest } from 'fastify';
import { kycService } from './kyc.service.js';
import {
  KycBvnInput,
  KycFaceInput,
  KycFaceLinkInput,
  KycNinInput,
  KycBusinessInput,
  KycAddressInput,
  KycKybInput,
  KycBankInput,
  KycDecisionInput,
} from './merchant.schema.js';

function getUserId(request: FastifyRequest): string {
  return request.user.userId;
}

export async function kycBvnHandler(
  request: FastifyRequest<{ Body: KycBvnInput }>,
  reply: FastifyReply
) {
  const userId = getUserId(request);
  const result = await kycService.verifyBvnStep(userId, request.body, request.ip);
  return reply.status(200).send({ success: true, data: result });
}

export async function kycFaceHandler(
  request: FastifyRequest<{ Body: KycFaceInput }>,
  reply: FastifyReply
) {
  const userId = getUserId(request);
  const result = await kycService.verifyFaceStep(userId, request.body, request.ip);
  return reply.status(200).send({ success: true, data: result });
}

export async function kycFaceLinkCreateHandler(
  request: FastifyRequest<{ Body: KycFaceLinkInput }>,
  reply: FastifyReply
) {
  const result = await kycService.createFaceLink(getUserId(request), request.body?.origin);
  return reply.status(200).send({ success: true, data: result });
}

// Public (token-authenticated): opened from the QR code on the merchant's phone.
export async function kycFaceLinkCheckHandler(
  request: FastifyRequest<{ Params: { token: string } }>,
  reply: FastifyReply
) {
  const result = await kycService.checkFaceLink(request.params.token);
  return reply.status(200).send({ success: true, data: result });
}

export async function kycFaceLinkSubmitHandler(
  request: FastifyRequest<{ Params: { token: string }; Body: KycFaceInput }>,
  reply: FastifyReply
) {
  const result = await kycService.submitFaceViaLink(request.params.token, request.body, request.ip);
  return reply.status(200).send({ success: true, data: result });
}

export async function kycNinHandler(
  request: FastifyRequest<{ Body: KycNinInput }>,
  reply: FastifyReply
) {
  const userId = getUserId(request);
  const result = await kycService.verifyNinStep(userId, request.body);
  return reply.status(200).send({ success: true, data: result });
}

export async function kycStatusHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const userId = getUserId(request);
  const result = await kycService.getKycStatus(userId);
  return reply.status(200).send({ success: true, data: result });
}

export async function kycBusinessHandler(
  request: FastifyRequest<{ Body: KycBusinessInput }>,
  reply: FastifyReply
) {
  const userId = getUserId(request);
  const result = await kycService.submitBusinessInfoStep(userId, request.body);
  return reply.status(200).send({ success: true, data: result });
}

export async function kycAddressHandler(
  request: FastifyRequest<{ Body: KycAddressInput }>,
  reply: FastifyReply
) {
  const userId = getUserId(request);
  const result = await kycService.submitAddressStep(userId, request.body);
  return reply.status(200).send({ success: true, data: result });
}

export async function kycKybHandler(
  request: FastifyRequest<{ Body: KycKybInput }>,
  reply: FastifyReply
) {
  const userId = getUserId(request);
  const result = await kycService.submitKybStep(userId, request.body);
  return reply.status(200).send({ success: true, data: result });
}

export async function kycBankHandler(
  request: FastifyRequest<{ Body: KycBankInput }>,
  reply: FastifyReply
) {
  const userId = getUserId(request);
  const result = await kycService.submitBankStep(userId, request.body);
  return reply.status(200).send({ success: true, data: result });
}

export async function kycSubmitHandler(
  request: FastifyRequest<{ Body: KycDecisionInput }>,
  reply: FastifyReply
) {
  const userId = getUserId(request);
  const result = await kycService.submitForDecision(userId, request.body);
  return reply.status(200).send({ success: true, data: result });
}
