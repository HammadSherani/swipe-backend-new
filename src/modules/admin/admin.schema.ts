import { z } from 'zod';

export const reviewDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  rejectionReason: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.decision === 'REJECT' && !data.rejectionReason?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'rejectionReason is required when rejecting',
      path: ['rejectionReason'],
    });
  }
});

export const merchantIdParamsSchema = z.object({
  id: z.string().uuid({ message: 'Invalid merchant ID' }),
});

export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;
export type MerchantIdParams = z.infer<typeof merchantIdParamsSchema>;
