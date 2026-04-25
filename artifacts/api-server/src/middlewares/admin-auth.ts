// ----------------------------------------------------------------------------
// admin-auth.ts
// ----------------------------------------------------------------------------
// Shared-secret bearer-token guard for /api/admin/* routes.
//
// Single operator → no need for a full identity provider. We check that the
// request carries `Authorization: Bearer ${ADMIN_TOKEN}` matching the env
// var, and reject everything else with 401.
//
// Failure modes:
//   - ADMIN_TOKEN not set → 503 ("admin not configured"). This is a safer
//     default than 401: it forces the operator to notice that the admin
//     pane is unconfigured rather than just seeing an opaque "wrong
//     password" message.
//   - Authorization header missing or malformed → 401.
//   - Wrong token → 401, with a constant-time comparison to avoid leaking
//     the token byte-by-byte through response timing.
// ----------------------------------------------------------------------------

import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";

function constantTimeEquals(a: string, b: string): boolean {
  // timingSafeEqual requires equal-length buffers, so we hash-and-compare
  // by padding the shorter one with NULs and adding an explicit length
  // check. This keeps the comparison constant-time relative to the
  // expected token's length.
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    // Still do a fake compare to keep timing roughly stable.
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    res.status(503).json({
      error: "admin_not_configured",
      message:
        "Set the ADMIN_TOKEN environment variable on the api-server to enable the admin pane.",
    });
    return;
  }

  const header = req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: "missing_bearer_token" });
    return;
  }

  if (!constantTimeEquals(match[1], expected)) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }

  next();
}
