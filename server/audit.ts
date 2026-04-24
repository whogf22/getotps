import type { Request } from "express";
import { storage } from "./storage";

function clientIp(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || null;
}

/**
 * Persists an audit row. For admin actions, pass `affectedUserId` in meta when the subject is another user.
 * For unauthenticated flows (e.g. email verification), pass `subjectUserId`.
 */
export async function writeAudit(
  req: Request,
  action: string,
  meta: Record<string, unknown> = {},
  subjectUserId?: number,
): Promise<void> {
  try {
    const actor = req.user as { id: number; role?: string } | undefined;
    const ip = clientIp(req);
    const userAgent = req.get("user-agent") || null;

    let userId: number | null = null;
    let adminId: number | null = null;

    if (typeof subjectUserId === "number" && Number.isFinite(subjectUserId)) {
      userId = subjectUserId;
    } else if (actor?.role === "admin") {
      adminId = actor.id;
      const aff = meta.affectedUserId;
      if (typeof aff === "number" && Number.isFinite(aff)) userId = aff;
    } else if (actor) {
      userId = actor.id;
    }

    await storage.insertAuditLog({
      userId,
      adminId,
      action,
      meta,
      ip,
      userAgent,
    });
  } catch {
    // Never fail the request path on audit persistence issues
  }
}
