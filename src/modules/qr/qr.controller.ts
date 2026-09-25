import { FastifyReply, FastifyRequest } from 'fastify';
import { QrService } from './qr.service.js';
import { GenerateStaticQrInput, GenerateDynamicQrInput, DecodeQrInput } from './qr.schema.js';

export async function generateStaticHandler(
  request: FastifyRequest<{ Body: GenerateStaticQrInput }>,
  reply: FastifyReply
) {
  const service = new QrService();
  const result = await service.generateStatic(request.body);
  return reply.status(201).send({ success: true, data: result });
}

export async function generateDynamicHandler(
  request: FastifyRequest<{ Body: GenerateDynamicQrInput }>,
  reply: FastifyReply
) {
  const service = new QrService();
  const result = await service.generateDynamic(request.body);
  return reply.status(201).send({ success: true, data: result });
}

export async function decodeHandler(
  request: FastifyRequest<{ Body: DecodeQrInput }>,
  reply: FastifyReply
) {
  const service = new QrService();
  const result = await service.decode(request.body);
  return reply.send({ success: true, data: result });
}

export async function getByMerchantHandler(
  request: FastifyRequest<{ Params: { merchantId: string } }>,
  reply: FastifyReply
) {
  const service = new QrService();
  const result = await service.getByMerchant(request.params.merchantId);
  return reply.send({ success: true, data: result });
}
