import { FastifyReply, FastifyRequest } from 'fastify';
import { MerchantService } from './merchant.service.js';
import { NibssCallbackInput } from './merchant.schema.js';

function getUserId(request: FastifyRequest): string {
  return request.user.userId;
}

export async function getMerchantHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const userId = getUserId(request);
  const service = new MerchantService();
  const result = await service.getByUserId(userId);
  return reply.send({ success: true, data: result });
}

export async function nibssCallbackHandler(
  request: FastifyRequest<{ Body: NibssCallbackInput }>,
  reply: FastifyReply
) {
  const service = new MerchantService();
  const result = await service.updateNibssStatus(
    request.body.merchantId,
    request.body.nibssId,
    request.body.status
  );
  return reply.send({ success: true, data: result });
}

export async function getBanksHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const service = new MerchantService();

  const result = await service.getBanks();

  return reply.status(200).send({
    success: true,
    data: result,
  });
}
