import crypto from "crypto";
import type { Request } from "express";
import { markWebhookProcessed } from "./core";

const MAX_SKEW_SECONDS = 300;

export function verifyWebhookSignature(params: {
  provider: string;
  req: Request;
  secret: string;
  signatureHeader: string;
  timestampHeader: string;
  webhookIdHeader: string;
}): { ok: true; webhookId: string; timestamp: number; duplicate: boolean } | { ok: false; reason: string } {
  const signature = params.req.header(params.signatureHeader);
  const timestampRaw = params.req.header(params.timestampHeader);
  const webhookId = params.req.header(params.webhookIdHeader);
  const rawBody = params.req.rawBody;

  if (!signature || !timestampRaw || !webhookId || !rawBody) {
    return { ok: false, reason: "Missing required webhook headers/body" };
  }

  const timestamp = Number.parseInt(timestampRaw, 10);
  if (Number.isNaN(timestamp)) return { ok: false, reason: "Invalid timestamp header" };

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "Webhook timestamp out of tolerance window" };
  }

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
  const expected = crypto
    .createHmac("sha256", params.secret)
    .update(`${timestamp}.${body.toString("utf8")}`)
    .digest("hex");

  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (signatureBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(signatureBuf, expectedBuf)) {
    return { ok: false, reason: "Invalid HMAC signature" };
  }

  const inserted = markWebhookProcessed(params.provider, webhookId, timestamp);
  return { ok: true, webhookId, timestamp, duplicate: !inserted };
}
