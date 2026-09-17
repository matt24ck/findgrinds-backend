import jwt, { SignOptions } from 'jsonwebtoken';

/**
 * JWT secret handling.
 *
 * There is deliberately NO fallback secret. A missing, short, or placeholder
 * JWT_SECRET is a fatal configuration error: the process refuses to sign or
 * verify tokens rather than silently running with a guessable key.
 */
const MIN_SECRET_LENGTH = 32;
const PLACEHOLDERS = new Set(['change-me', 'changeme', 'dev-secret', 'secret', 'jwt-secret']);

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH || PLACEHOLDERS.has(secret.trim().toLowerCase())) {
    throw new Error(
      `JWT_SECRET must be set to a random string of at least ${MIN_SECRET_LENGTH} characters. ` +
        'Refusing to sign or verify tokens with a missing or placeholder secret. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
  }
  return secret;
}

/** Call once at boot so a bad secret fails the process before it accepts traffic. */
export function assertJwtSecretConfigured(): void {
  getJwtSecret();
}

export interface JwtPayload {
  userId: string;
  userType: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, getJwtSecret()) as JwtPayload;
}
