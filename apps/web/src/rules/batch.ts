import { buildRulePlan } from '@mcs/schema-core';
import type { RuleTypeSpec } from '@mcs/schema-core';

import type { IssueFix } from '../worker/protocol.js';

const RULES_PATH = ['rules'];

/**
 * Batch patch construction (v0.4.0 #10, ADR-023) — every function here is
 * pure: given the current `rules` array and a selection, it returns the
 * `IssueFix[]` a caller sends to `client.applyBatch()` as one atomic,
 * single-undo-step write. None of these touch the document themselves —
 * that stays the Worker's job, same as every other `IssueFix` producer.
 */

/**
 * Shifts the whole selected block up or down by one position in a single
 * `move`, regardless of how many rows are selected: only the row
 * immediately outside the block on the relevant side needs to move across
 * it (splicing it out and back in shifts everything between unchanged
 * relative order). A no-op (`[]`) at the boundary — nothing before the
 * first row to move up, nothing after the last row to move down.
 */
export function buildBatchMovePatches(
  indices: readonly number[],
  itemCount: number,
  direction: 'up' | 'down',
): IssueFix[] {
  if (indices.length === 0) return [];
  const sorted = [...indices].sort((a, b) => a - b);
  const min = sorted[0] as number;
  const max = sorted[sorted.length - 1] as number;
  if (direction === 'up') {
    if (min === 0) return [];
    return [{ kind: 'move', path: RULES_PATH, from: min - 1, to: max }];
  }
  if (max === itemCount - 1) return [];
  return [{ kind: 'move', path: RULES_PATH, from: max + 1, to: min }];
}

/**
 * Duplicates the selected rows immediately after the last one, preserving
 * their original relative order — `append` (the only way to add an item at
 * all) always lands at the end, so each copy is appended first and then
 * `move`d into place. The `from` index for the i-th copy is always
 * `originalLength + i`, unaffected by the earlier copies' own moves: a
 * remove-then-insert-earlier nets to zero shift for anything positioned at
 * or after the insertion point, which every later copy always is.
 */
export function buildBatchCopyPatches(
  indices: readonly number[],
  rules: readonly string[],
): IssueFix[] {
  if (indices.length === 0) return [];
  const sorted = [...indices].sort((a, b) => a - b);
  const originalLength = rules.length;
  const insertAfter = sorted[sorted.length - 1] as number;
  const patches: IssueFix[] = [];
  for (const index of sorted) {
    const text = rules[index];
    if (text !== undefined) patches.push({ kind: 'append', path: RULES_PATH, value: text });
  }
  sorted.forEach((_, i) => {
    patches.push({
      kind: 'move',
      path: RULES_PATH,
      from: originalLength + i,
      to: insertAfter + 1 + i,
    });
  });
  return patches;
}

/**
 * Removes the selected rows in descending index order — removing ascending
 * would shift every later index left as each earlier one disappears,
 * corrupting the remaining `path`s mid-batch (the easiest mistake to make
 * here, per ADR-023).
 */
export function buildBatchDeletePatches(indices: readonly number[]): IssueFix[] {
  return [...indices]
    .sort((a, b) => b - a)
    .map((index) => ({ kind: 'remove', path: [...RULES_PATH, index] }));
}

/**
 * Rewrites each selected row's target (outbound policy) to `newTarget`,
 * keeping its type/payload/params untouched. Skips a row this app cannot
 * structurally parse (`{kind:'raw'}` — FR-RULE-05 fidelity: never guess at
 * an unrecognised rule's shape) and a `SUB-RULE` row (its "target" fragment
 * names a sub-rule group, not an outbound policy — rewriting it with a
 * policy name would corrupt the reference, not update it).
 */
export function buildBatchReplaceTargetPatches(
  indices: readonly number[],
  rules: readonly string[],
  catalog: readonly RuleTypeSpec[],
  newTarget: string,
): IssueFix[] {
  const patches: IssueFix[] = [];
  for (const index of indices) {
    const text = rules[index];
    if (text === undefined) continue;
    const plan = buildRulePlan(catalog, text);
    if (plan.kind === 'raw') continue;
    if (plan.spec.payloadKind === 'sub-rule') continue;

    const segments = [plan.spec.type];
    if (plan.spec.needsPayload) segments.push(plan.payload?.value ?? '');
    segments.push(newTarget);
    for (const param of plan.spec.params) {
      if (plan.params.some((p) => p.value === param)) segments.push(param);
    }
    patches.push({ kind: 'set', path: [...RULES_PATH, index], value: segments.join(',') });
  }
  return patches;
}
