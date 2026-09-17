import rateLimit from 'express-rate-limit';

/**
 * Rate limiters for the unauthenticated surface (auth + public AI chat).
 *
 * Limits are per client IP and configurable via env. They are disabled under
 * NODE_ENV=test unless RATE_LIMIT_ENABLED=true so integration tests are not
 * throttled; set RATE_LIMIT_ENABLED=false to disable them elsewhere.
 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function rateLimitingEnabled(): boolean {
  const flag = process.env.RATE_LIMIT_ENABLED;
  if (flag !== undefined) return flag !== 'false';
  return process.env.NODE_ENV !== 'test';
}

const common = {
  standardHeaders: 'draft-8' as const,
  legacyHeaders: false,
  skip: () => !rateLimitingEnabled(),
};

/** Signup, login, forgot-password, reset-password: 20 requests / 15 min / IP by default. */
export const authLimiter = rateLimit({
  ...common,
  windowMs: envInt('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  limit: envInt('AUTH_RATE_LIMIT_MAX', 20),
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

/** Public AI chat: 30 requests / 10 min / IP by default. */
export const chatLimiter = rateLimit({
  ...common,
  windowMs: envInt('CHAT_RATE_LIMIT_WINDOW_MS', 10 * 60 * 1000),
  limit: envInt('CHAT_RATE_LIMIT_MAX', 30),
  message: { error: 'The assistant is busy. Please wait a few minutes and try again.' },
});
