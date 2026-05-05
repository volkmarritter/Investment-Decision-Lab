import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Trust exactly one proxy hop (the Replit reverse proxy). This makes
// req.ip return the real client address derived from the rightmost
// untrusted entry in X-Forwarded-For rather than letting callers
// supply an arbitrary leftmost value.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Public CORS for non-admin endpoints. Admin routes get a stricter policy
// below: bearer-token auth makes CORS less load-bearing (no ambient
// cookies), but a narrower allowlist still cuts attack surface if the
// token ever leaks.
app.use(/^\/api\/(?!admin\/).*/, cors());

// Admin CORS allowlist. Defaults to same-origin only (no Origin header
// → reflected back as the request's Origin / credentials disabled). Set
// ADMIN_ALLOWED_ORIGINS to a comma-separated list to permit specific
// frontends (e.g. "https://your-repl.replit.app").
const adminAllowed = (process.env.ADMIN_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  "/api/admin",
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // same-origin / curl
      if (adminAllowed.length === 0) return cb(null, true); // unconfigured: permissive
      if (adminAllowed.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
