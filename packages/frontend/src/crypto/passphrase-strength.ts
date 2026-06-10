// zxcvbn-style strength estimator. Returns a 0-4 score that mirrors the
// semantics of zxcvbn's `score`:
//   0 = trivially guessable (top-1k passwords, single char class, very short)
//   1 = weak (online-attack feasible)
//   2 = moderate (slow online-attack feasible)
//   3 = strong — minimum acceptable for vault setup
//   4 = very strong (offline brute-force resistant)
//
// We don't pull in zxcvbn (~700KB) for a single gate. The heuristics here are
// deliberately conservative: short, single-class, or pattern-heavy inputs
// always score < 3, and the long-passphrase path requires real entropy from
// length AND class diversity.

const COMMON_TOP100 = new Set([
  '123456', '123456789', 'qwerty', 'password', '12345', '12345678', '111111',
  '1234567', 'sunshine', 'qwerty123', '1q2w3e', 'admin', 'welcome', 'iloveyou',
  'monkey', 'dragon', 'letmein', 'abc123', 'master', 'football', 'baseball',
  'shadow', 'superman', 'michael', 'jennifer', 'jordan', '696969', 'mustang',
  'starwars', 'access', 'ranger', 'harley', 'pepper', 'merlin',
]);

function classCount(s: string): number {
  let n = 0;
  if (/[a-z]/.test(s)) n++;
  if (/[A-Z]/.test(s)) n++;
  if (/[0-9]/.test(s)) n++;
  if (/[^a-zA-Z0-9]/.test(s)) n++;
  return n;
}

function hasObviousPattern(s: string): boolean {
  if (/(.)\1{3,}/.test(s)) return true;          // 4+ repeated chars
  if (/0123|1234|2345|3456|4567|5678|6789/.test(s)) return true;
  if (/abcd|bcde|cdef|defg/i.test(s)) return true;
  if (/qwer|wert|erty|asdf|zxcv/i.test(s)) return true;
  return false;
}

export function estimatePassphraseStrength(input: string): number {
  if (!input) return 0;
  const s = input.normalize('NFKC');
  const lower = s.toLowerCase();
  if (COMMON_TOP100.has(lower)) return 0;
  if (s.length < 8) return 0;

  const classes = classCount(s);
  const pattern = hasObviousPattern(s);

  // Single-class short — always weak.
  if (s.length < 10 && classes <= 1) return 0;
  if (s.length < 12 && pattern) return 1;

  // Length-driven scoring with class-diversity multiplier.
  let score = 0;
  if (s.length >= 8) score = 1;
  if (s.length >= 10 && classes >= 2) score = 2;
  if (s.length >= 12 && classes >= 2) score = 3;
  if (s.length >= 14 && classes >= 3) score = 4;
  if (s.length >= 16 && classes >= 2 && !pattern) score = Math.max(score, 3);
  if (s.length >= 20 && !pattern) score = Math.max(score, 4);

  if (pattern) score = Math.min(score, 1);

  return Math.max(0, Math.min(4, score));
}

export const STRENGTH_LABELS = ['Very weak', 'Weak', 'Moderate', 'Strong', 'Very strong'] as const;
