import { BadRequestException } from '@nestjs/common';

const EMAIL_RE = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/;
const MAX_LENGTH = 254; // RFC 5321 §4.5.3.1.3

export function canonicalizeEmail(raw: string): string {
  if (typeof raw !== 'string') throw new BadRequestException('email format');
  const s = raw.normalize('NFC').trim().toLowerCase();
  if (s.length === 0) throw new BadRequestException('email empty');
  if (s.length > MAX_LENGTH) throw new BadRequestException('email too long');
  if (!EMAIL_RE.test(s)) throw new BadRequestException('email format');
  if (s.includes('..')) throw new BadRequestException('email format');
  if (s.startsWith('.') || s.includes('.@')) throw new BadRequestException('email format');
  return s;
}
