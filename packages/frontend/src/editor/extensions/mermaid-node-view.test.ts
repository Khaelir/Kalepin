import { describe, it, expect } from 'vitest';
import { isSelectionInsideNode } from './mermaid-node-view';

// The node view drives its edit-mode lifecycle from PM's selection: the user
// is "still editing" iff the cursor sits inside this block. This pure helper
// is the entire decision; cover its boundaries.

describe('isSelectionInsideNode', () => {
  // A block at pos=10 of size=20 occupies positions [10, 30).
  const POS = 10;
  const SIZE = 20;

  it('returns true when collapsed cursor is at the very start of the node', () => {
    expect(isSelectionInsideNode(POS, POS, POS, SIZE)).toBe(true);
  });

  it('returns true when collapsed cursor is at the very end of the node', () => {
    expect(isSelectionInsideNode(POS + SIZE, POS + SIZE, POS, SIZE)).toBe(true);
  });

  it('returns true when collapsed cursor is in the middle of the node', () => {
    expect(isSelectionInsideNode(POS + 5, POS + 5, POS, SIZE)).toBe(true);
  });

  it('returns true when a range selection is fully contained', () => {
    expect(isSelectionInsideNode(POS + 2, POS + 8, POS, SIZE)).toBe(true);
  });

  it('returns false when the cursor sits before the node', () => {
    expect(isSelectionInsideNode(POS - 1, POS - 1, POS, SIZE)).toBe(false);
  });

  it('returns false when the cursor sits after the node', () => {
    expect(isSelectionInsideNode(POS + SIZE + 1, POS + SIZE + 1, POS, SIZE)).toBe(false);
  });

  it('returns false when a range selection crosses the start boundary', () => {
    expect(isSelectionInsideNode(POS - 2, POS + 5, POS, SIZE)).toBe(false);
  });

  it('returns false when a range selection crosses the end boundary', () => {
    expect(isSelectionInsideNode(POS + 5, POS + SIZE + 2, POS, SIZE)).toBe(false);
  });

  it('returns false when the selection wraps the node entirely', () => {
    expect(isSelectionInsideNode(POS - 5, POS + SIZE + 5, POS, SIZE)).toBe(false);
  });
});
