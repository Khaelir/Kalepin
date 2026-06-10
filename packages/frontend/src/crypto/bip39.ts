// 24-word BIP-39 recovery phrase. Pure JS, no WASM, no network — `@scure/bip39`
// ships the English wordlist as a tiny array constant and runs against
// WebCrypto's `getRandomValues`.
//
// The phrase encodes 256 bits of entropy + 8 bits of checksum (24 words ×
// 11 bits = 264 bits). We feed those 32 entropy bytes — NOT the words — into
// Argon2id to derive the recovery-KEK; the words are the user-facing surface
// only.

import { generateMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist as english } from '@scure/bip39/wordlists/english.js';

export const BIP39_WORD_COUNT = 24;

/** Generate a fresh 24-word phrase. Words are space-separated. */
export function generateRecoveryPhrase(): string {
  // 256 bits of entropy → 24 English words.
  return generateMnemonic(english, 256);
}

/** Convert a phrase to its raw 32-byte entropy (used as KDF input). */
export function recoveryPhraseToBytes(phrase: string): Uint8Array {
  const trimmed = normalizePhrase(phrase);
  if (!validateMnemonic(trimmed, english)) {
    throw new Error('invalid BIP-39 phrase');
  }
  return mnemonicToEntropy(trimmed, english);
}

export function isWordInWordlist(word: string): boolean {
  return english.includes(word.toLowerCase().trim());
}

/** Normalize whitespace so a pasted phrase with extra spaces still validates. */
export function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).join(' ');
}

export function splitPhraseWords(phrase: string): string[] {
  return normalizePhrase(phrase).split(' ');
}
