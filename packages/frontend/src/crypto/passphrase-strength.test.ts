import { describe, it, expect } from 'vitest';
import { estimatePassphraseStrength } from './passphrase-strength';

describe('estimatePassphraseStrength', () => {
  it('scores empty and trivial inputs as 0', () => {
    expect(estimatePassphraseStrength('')).toBe(0);
    expect(estimatePassphraseStrength('123456')).toBe(0);
    expect(estimatePassphraseStrength('password')).toBe(0);
  });

  it('scores short single-class inputs below 3', () => {
    expect(estimatePassphraseStrength('abcdef')).toBeLessThan(3);
    expect(estimatePassphraseStrength('aaaaaaaaaa')).toBeLessThan(3);
  });

  it('penalises obvious patterns', () => {
    expect(estimatePassphraseStrength('qwerty1234')).toBeLessThan(3);
    expect(estimatePassphraseStrength('aaaa1111bb!!')).toBeLessThan(3);
  });

  it('scores well-mixed long passphrases at 3+', () => {
    expect(estimatePassphraseStrength('Tr0ub4dor&3xtra')).toBeGreaterThanOrEqual(3);
    expect(estimatePassphraseStrength('correct horse battery staple!')).toBeGreaterThanOrEqual(3);
  });

  it('caps very strong inputs at 4', () => {
    const s = estimatePassphraseStrength('Tr0ub4dor&3xtra-correct-horse-battery-staple!');
    expect(s).toBe(4);
  });
});
