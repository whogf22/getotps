import type { Request, Response, NextFunction } from "express";
import type { z, ZodTypeAny } from "zod";

export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        issues: parsed.error.flatten(),
      });
    }
    (req as Request & { validatedBody: z.infer<T> }).validatedBody = parsed.data;
    req.body = parsed.data;
    return next();
  };
}
