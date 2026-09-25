// File: apps/backend/src/app.ts

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import jwtPlugin from './plugins/jwt.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import swaggerPlugin from './plugins/swagger.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { merchantRoutes } from './modules/merchant/merchant.routes.js';
import { qrRoutes } from './modules/qr/qr.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';

export async function buildApp() {
  // KYC selfies / proof-of-address arrive as base64 in the JSON body; Fastify's
  // 1 MiB default rejects a normal phone photo (base64 adds ~33%).
  const app = Fastify({ logger, bodyLimit: 15 * 1024 * 1024 });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
  });

  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  // Error handling and 404 first, so every route below is covered
  await app.register(errorHandlerPlugin);

  await app.register(jwtPlugin);
  await app.register(swaggerPlugin);

  // Module routes — same prefixes the old api-gateway proxied to, so
  // existing frontend API calls keep working unchanged.
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(merchantRoutes, { prefix: '/merchant' });
  await app.register(qrRoutes, { prefix: '/qr' });
  await app.register(adminRoutes, { prefix: '/admin' });

  app.get('/health', async () => ({ status: 'ok', service: 'backend' }));

  return app;
}
