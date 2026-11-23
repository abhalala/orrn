/**
 * XE parity lane HR, row 93: biometric devices that push punches over HTTP. The device's bearer token
 * (made on the HR devices screen, stored hashed) names the device and so the plant; nothing in the body
 * names a company. Logic lives in @orrn/server/lib/hr/punches so tests drive the same code. The make of
 * the plant's devices is an owner item: today's one format is orrn's JSON (`?format=orrn-json`).
 */
import { createDb } from "@orrn/db";
import { Hono } from "hono";

import { readCollectorBody } from "@orrn/server/lib/collectorNode";
import { handleHrPunchPush, HR_PUNCH_PUSH_PATH } from "@orrn/server/lib/hr/punches";

const hrRoutes = new Hono();

hrRoutes.post(HR_PUNCH_PUSH_PATH, async (c) => {
  const read = await readCollectorBody(c.req.raw);
  if (!read.ok) return c.json({ error: "Body too large" }, read.status);
  const result = await handleHrPunchPush(createDb(), { authorization: c.req.header("Authorization"), rawBody: new TextDecoder().decode(read.body), adapter: c.req.query("format") ?? undefined });
  return c.json(result.body, result.status);
});

export { hrRoutes };
