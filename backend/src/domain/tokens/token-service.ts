import { randomBytes, createHash, timingSafeEqual } from 'crypto';

const TOKEN_BYTE_LENGTH = 32; // 256-bit
const TOKEN_PREFIX = 'dev_';

export interface GeneratedToken {
  raw: string; // returned to client exactly once
  hash: string; // stored in DB
}

export function generateAccessToken(): GeneratedToken {
  const raw = TOKEN_PREFIX + randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
  const hash = hashToken(raw);
  return { raw, hash };
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function verifyToken(raw: string, storedHash: string): boolean {
  const candidate = hashToken(raw);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
