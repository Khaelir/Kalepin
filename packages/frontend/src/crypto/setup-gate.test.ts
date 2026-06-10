import { describe, it, expect } from 'vitest';
import { evaluateSetupGate, isTypedConfirmationValid } from './setup-gate';

const STRONG = 'Tr0ub4dor&3xtra-correct-horse';

describe('evaluateSetupGate', () => {
  it('accepts when all four gates pass', () => {
    const r = evaluateSetupGate({
      passphrase: STRONG,
      confirm: STRONG,
      typedConfirmation: 'I understand',
      recoveryChoice: 'generate',
    });
    expect(r.canSubmit).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it('rejects when passphrases mismatch', () => {
    const r = evaluateSetupGate({
      passphrase: STRONG,
      confirm: STRONG + 'x',
      typedConfirmation: 'I understand',
      recoveryChoice: 'skip',
    });
    expect(r.canSubmit).toBe(false);
    expect(r.reasons.some((m) => /match/i.test(m))).toBe(true);
  });

  it('rejects on weak strength score < 3', () => {
    const r = evaluateSetupGate({
      passphrase: 'password',
      confirm: 'password',
      typedConfirmation: 'I understand',
      recoveryChoice: 'skip',
    });
    expect(r.canSubmit).toBe(false);
    expect(r.score).toBeLessThan(3);
    expect(r.reasons.some((m) => /strong/i.test(m))).toBe(true);
  });

  it('rejects when typed confirmation absent', () => {
    const r = evaluateSetupGate({
      passphrase: STRONG,
      confirm: STRONG,
      typedConfirmation: '',
      recoveryChoice: 'skip',
    });
    expect(r.canSubmit).toBe(false);
    expect(r.reasons.some((m) => /understand/i.test(m))).toBe(true);
  });

  it('rejects when typed confirmation wrong', () => {
    const r = evaluateSetupGate({
      passphrase: STRONG,
      confirm: STRONG,
      typedConfirmation: 'understood',
      recoveryChoice: 'skip',
    });
    expect(r.canSubmit).toBe(false);
    expect(r.reasons.some((m) => /understand/i.test(m))).toBe(true);
  });

  it('accepts case-insensitive trimmed typed confirmation', () => {
    expect(isTypedConfirmationValid('  I UNDERSTAND  ')).toBe(true);
    expect(isTypedConfirmationValid('i understand')).toBe(true);
    expect(isTypedConfirmationValid('  I unDerStaNd ')).toBe(true);
  });

  it('rejects when recovery choice unset', () => {
    const r = evaluateSetupGate({
      passphrase: STRONG,
      confirm: STRONG,
      typedConfirmation: 'I understand',
      recoveryChoice: 'unset',
    });
    expect(r.canSubmit).toBe(false);
    expect(r.reasons.some((m) => /recovery/i.test(m))).toBe(true);
  });

  it('does not allow a checkbox-only acknowledgement to satisfy the gate', () => {
    // Simulate what a checkbox-only impl would supply: a fixed truthy string
    // that is not the literal "I understand" phrase.
    const r = evaluateSetupGate({
      passphrase: STRONG,
      confirm: STRONG,
      typedConfirmation: 'true',
      recoveryChoice: 'generate',
    });
    expect(r.canSubmit).toBe(false);
  });
});
