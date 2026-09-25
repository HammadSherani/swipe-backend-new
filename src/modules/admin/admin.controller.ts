import { FastifyReply, FastifyRequest } from 'fastify';
import { adminService } from './admin.service.js';
import { ReviewDecisionInput } from './admin.schema.js';

export async function getDashboardStatsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const result = await adminService.getDashboardStats();
  return reply.status(200).send({ success: true, data: result });
}

export async function listPendingReviewHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const result = await adminService.listPendingReview();
  return reply.status(200).send({ success: true, data: result });
}

export async function decideHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: ReviewDecisionInput }>,
  reply: FastifyReply
) {
  const adminUserId = request.user.userId;
  const result = await adminService.decide(request.params.id, request.body, adminUserId);
  return reply.status(200).send({ success: true, data: result });
}
