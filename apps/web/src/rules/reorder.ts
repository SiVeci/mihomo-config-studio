/**
 * Given a rule's current index and a move operation, computes where it
 * should land — the pure decision both the keyboard path (#9) and the
 * drag path make, so the two ever agreeing is a property of one shared
 * function rather than two hand-kept-in-sync implementations. Returns the
 * unchanged index for a boundary no-op (e.g. `'up'` on index 0) rather
 * than clamping to something a caller has to special-case: `target ===
 * index` is already the caller's own signal to skip the `move` entirely.
 */

export type ReorderOperation = 'up' | 'down' | 'home' | 'end';

export interface ReorderTargetInput {
  readonly itemCount: number;
  readonly index: number;
  readonly operation: ReorderOperation;
}

export function computeReorderTarget({ itemCount, index, operation }: ReorderTargetInput): number {
  if (itemCount <= 1) return index;
  const current = Math.min(Math.max(index, 0), itemCount - 1);
  switch (operation) {
    case 'up':
      return Math.max(0, current - 1);
    case 'down':
      return Math.min(itemCount - 1, current + 1);
    case 'home':
      return 0;
    case 'end':
      return itemCount - 1;
  }
}
