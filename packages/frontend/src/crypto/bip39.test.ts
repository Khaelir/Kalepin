import { describe, it, expect } from 'vitest';
import {
  generateRecoveryPhrase,
  recoveryPhraseToBytes,
  isWordInWordlist,
  splitPhraseWords,
  BIP39_WORD_COUNT,
} from './bip39';

describe('bip39', () => {
  it('generates a 24-word phrase', () => {
    const phrase = generateRecoveryPhrase();
    expect(splitPhraseWords(phrase)).toHaveLength(BIP39_WORD_COUNT);
  });

  it('round-trips phrase to 32-byte entropy', () => {
    const phrase = generateRecoveryPhrase();
    const bytes = recoveryPhraseToBytes(phrase);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32);
  });

  it('rejects an invalid phrase', () => {
    expect(() => recoveryPhraseToBytes('not a real phrase at all')).toThrow();
  });

  it('detects in/out-of-wordlist words', () => {
    expect(isWordInWordlist('abandon')).toBe(true);
    expect(isWordInWordlist('xyzzy123')).toBe(false);
  });

  it('two phrases produce different entropy', () => {
    const a = recoveryPhraseToBytes(generateRecoveryPhrase());
    const b = recoveryPhraseToBytes(generateRecoveryPhrase());
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});
