import { z } from "zod";

export const registerBodySchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/),
  email: z.string().email(),
  password: z.string().min(8),
  cfTurnstileResponse: z.string().optional(),
  turnstileToken: z.string().optional(),
});

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
  cfTurnstileResponse: z.string().optional(),
  turnstileToken: z.string().optional(),
});

export const admin2faVerifyBodySchema = z.object({
  token: z.string().regex(/^\d{6}$/),
});

export const admin2faDisableBodySchema = z.object({
  token: z.string().regex(/^\d{6}$/),
});

export const forgotPasswordBodySchema = z.object({
  email: z.string().email(),
  cfTurnstileResponse: z.string().optional(),
  turnstileToken: z.string().optional(),
});

export const resetPasswordBodySchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8),
});

export const verifyEmailBodySchema = z.object({
  token: z.string().min(10),
});

export const createDepositBodySchema = z.object({
  currency: z.string().min(2).max(32),
  amount: z.string().min(1).max(32),
  cfTurnstileResponse: z.string().optional(),
  turnstileToken: z.string().optional(),
});
