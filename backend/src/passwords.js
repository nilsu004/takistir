import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Salted scrypt hashes stored as "salt:hash" (hex). Moved unchanged from the
// former SQLite store.
export function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function passwordMatches(password, stored) {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(
    Buffer.from(hash, 'hex'),
    scryptSync(password, salt, 64),
  );
}
