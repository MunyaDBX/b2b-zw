import { z } from 'zod';

export const E164 = /^\+[1-9]\d{7,14}$/;

export const proposalSchema = z.object({
  bidAmount: z.coerce.number({ invalid_type_error: 'Enter a number' }).positive('Must be greater than 0'),
  deliveryDays: z.coerce.number().int().positive('Must be at least 1 day').max(365),
  notes: z.string().trim().max(2000).optional(),
});
export type ProposalInput = z.input<typeof proposalSchema>;
export type ProposalValues = z.output<typeof proposalSchema>;
