// Pure logic for the vault setup dialog's submit gate. Factored out of the
// component so the four gates from tasks.md §5.7 are tested without rendering.

import { estimatePassphraseStrength } from './passphrase-strength';

export type RecoveryChoice = 'unset' | 'skip' | 'generate';

export interface SetupGateInput {
  passphrase: string;
  confirm: string;
  typedConfirmation: string;
  recoveryChoice: RecoveryChoice;
}

export interface SetupGateResult {
  canSubmit: boolean;
  /** Human-readable reasons the gate is closed. Empty when canSubmit is true. */
  reasons: string[];
  /** Cached strength score so the meter and gate can't disagree. */
  score: number;
}

const TYPED_CONFIRMATION = 'i understand';
const MIN_SCORE = 3;

export function normalizeTypedConfirmation(value: string): string {
  return value.trim().toLowerCase();
}

export function isTypedConfirmationValid(value: string): boolean {
  return normalizeTypedConfirmation(value) === TYPED_CONFIRMATION;
}

export function evaluateSetupGate(input: SetupGateInput): SetupGateResult {
  const reasons: string[] = [];
  const score = estimatePassphraseStrength(input.passphrase);

  if (input.passphrase.length === 0) {
    reasons.push('Choose a passphrase.');
  } else if (input.passphrase !== input.confirm) {
    reasons.push('Passphrases do not match.');
  }
  if (input.passphrase.length > 0 && score < MIN_SCORE) {
    reasons.push('Passphrase is not strong enough.');
  }
  if (!isTypedConfirmationValid(input.typedConfirmation)) {
    reasons.push('Type "I understand" to acknowledge the warning.');
  }
  if (input.recoveryChoice === 'unset') {
    reasons.push('Choose whether to generate a recovery phrase.');
  }

  return { canSubmit: reasons.length === 0, reasons, score };
}
