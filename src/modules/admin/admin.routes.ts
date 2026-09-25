import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { listPendingReviewHandler, decideHandler, getDashboardStatsHandler } from './admin.controller.js';
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
}
