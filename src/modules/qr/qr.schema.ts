import { z } from 'zod';

export const generateStaticQrSchema = z.object({
  merchantId: z.string().uuid(),
});

export const generateDynamicQrSchema = z.object({
  merchantId: z.string().uuid(),
  amount: z.number().positive(),
  description: z.string().optional(),
});

export const decodeQrSchema = z.object({
  rawData: z.string(),
});

export type GenerateStaticQrInput = z.infer<typeof generateStaticQrSchema>;
export type GenerateDynamicQrInput = z.infer<typeof generateDynamicQrSchema>;
export type DecodeQrInput = z.infer<typeof decodeQrSchema>;
