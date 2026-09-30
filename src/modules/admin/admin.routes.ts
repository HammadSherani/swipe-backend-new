import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  listPendingReviewHandler,
  listMerchantsHandler,
  decideHandler,
  blockMerchantHandler,
  getDashboardStatsHandler,
  getMerchantDetailHandler,
  deleteMerchantHandler,
} from './admin.controller.js';
import { reviewDecisionSchema, merchantIdParamsSchema } from './admin.schema.js';

export async function adminRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/dashboard/stats', {
    schema: { tags: ['Admin'], description: 'Merchant counts by status, for the admin dashboard' },
    preHandler: [fastify.authenticate, fastify.requireAdmin],
    handler: getDashboardStatsHandler,
  });

  app.get('/merchants/pending-review', {
    schema: { tags: ['Admin'], description: 'List merchants pending review' },
    preHandler: [fastify.authenticate, fastify.requireAdmin],
    handler: listPendingReviewHandler,
  });

  app.get('/merchants', {
    schema: { tags: ['Admin'], description: 'List all merchants' },
    preHandler: [fastify.authenticate, fastify.requireAdmin],
    handler: listMerchantsHandler,
  });

  app.get('/merchants/:id', {
    schema: {
      tags: ['Admin'],
      description: 'Get full merchant detail for the admin review page',
      params: merchantIdParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireAdmin],
    handler: getMerchantDetailHandler,
  });

  app.post('/merchants/:id/decide', {
    schema: {
      tags: ['Admin'],
      description: 'Final approve/reject decision on a merchant pending review',
      params: merchantIdParamsSchema,
      body: reviewDecisionSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireAdmin],
    handler: decideHandler,
  });

  app.post('/merchants/:id/block', {
    schema: {
      tags: ['Admin'],
      description: 'Suspend an active merchant',
      params: merchantIdParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireAdmin],
    handler: blockMerchantHandler,
  });

  app.delete('/merchants/:id', {
    schema: {
      tags: ['Admin'],
      description: 'Permanently delete a merchant, its account, and related records',
      params: merchantIdParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireAdmin],
    handler: deleteMerchantHandler,
  });
}
