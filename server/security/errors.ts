import { safeProviderNeutralMessage } from "./provider-scrub";

export class ProviderError extends Error {}
export class InsufficientFundsError extends Error {}
export class AuthError extends Error {}
export class RateLimitError extends Error {}

export function toSafeErrorResponse(err: unknown): { status: number; message: string } {
  if (err instanceof ProviderError) {
    return { status: 503, message: "Service temporarily unavailable. Please try again." };
  }
  if (err instanceof InsufficientFundsError) {
    return { status: 402, message: "Insufficient balance." };
  }
  if (err instanceof AuthError) {
    return { status: 401, message: "Unauthorized." };
  }
  if (err instanceof RateLimitError) {
    return { status: 429, message: "Too many requests. Please wait." };
  }
  if (err && typeof err === "object" && "name" in err && (err as { name?: string }).name === "ZodError") {
    return { status: 400, message: "Validation failed." };
  }
  if (err instanceof Error && /validation/i.test(err.message)) {
    return { status: 400, message: "Validation failed." };
  }
  if (err instanceof Error && /provider|tellabot|circle|wallet|upstream/i.test(err.message)) {
    return { status: 503, message: safeProviderNeutralMessage() };
  }
  return { status: 500, message: "Something went wrong. Please contact support." };
}
