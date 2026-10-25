import { z } from 'zod';

/** Shared by sign-up, password reset and change password. */
export const passwordRule = z
  .string()
  .min(8, 'At least 8 characters')
  .regex(/[A-Za-z]/, 'Include a letter')
  .regex(/[0-9]/, 'Include a number');

export const emailRule = z.string().trim().toLowerCase().email('Enter a valid email');
