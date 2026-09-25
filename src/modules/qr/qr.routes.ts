import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  generateStaticHandler,
  generateDynamicHandler,
  decodeHandler,
  getByMerchantHandler,
} from './qr.controller.js';
import { generateStaticQrSchema, generateDynamicQrSchema, decodeQrSchema } from './qr.schema.js';

export async function qrRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post('/static', {
    schema: { tags: ['QR'], description: 'Generate static QR', body: generateStaticQrSchema },
    preHandler: fastify.authenticate,
    handler: generateStaticHandler,
  });

  app.post('/dynamic', {
    schema: { tags: ['QR'], description: 'Generate dynamic (per-transaction) QR', body: generateDynamicQrSchema },
    preHandler: fastify.authenticate,
    handler: generateDynamicHandler,
  });

  app.get('/merchant/:merchantId', {
    schema: { tags: ['QR'], description: "Get a merchant's QR codes" },
    preHandler: fastify.authenticate,
    handler: getByMerchantHandler,
  });

  // Public — customer scans and decodes
  app.post('/decode', {
    schema: { tags: ['QR'], description: 'Decode/validate a scanned QR', body: decodeQrSchema },
    handler: decodeHandler,
  });
}
