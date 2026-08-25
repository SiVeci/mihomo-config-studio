import type { RuleTypeSpec } from '@mcs/schema-core';
import { describe, expect, it } from 'vitest';

import type { IssueFix } from '../worker/protocol.js';
import {
  buildBatchCopyPatches,
  buildBatchDeletePatches,
  buildBatchMovePatches,
  buildBatchReplaceTargetPatches,
} from './batch.js';

/** Applies a patch list to a plain array the same way the real Worker's `applyIssueFix` would, so these pure functions can be verified against their actual end effect, not just their raw patch shape. */
function apply(rules: string[], patches: readonly IssueFix[]): string[] {
  const result = [...rules];
  for (const patch of patches) {
    if (patch.kind === 'append') {
      result.push(patch.value as string);
    } else if (patch.kind === 'move') {
      const [moved] = result.splice(patch.from, 1);
      result.splice(patch.to, 0, moved as string);
    } else if (patch.kind === 'remove') {
      const index = patch.path[patch.path.length - 1] as number;
      result.splice(index, 1);
    } else if (patch.kind === 'set') {
      const index = patch.path[patch.path.length - 1] as number;
      result[index] = patch.value as string;
    }
  }
  return result;
}

describe('buildBatchMovePatches', () => {
  const RULES = ['A', 'B', 'C', 'D', 'E'];

  it('moves a contiguous multi-row block up as one unit, in a single move patch', () => {
    const patches = buildBatchMovePatches([1, 2], RULES.length, 'up');
    expect(patches).toHaveLength(1);
    expect(apply(RULES, patches)).toEqual(['B', 'C', 'A', 'D', 'E']);
  });

  it('moves a contiguous multi-row block down as one unit', () => {
    const patches = buildBatchMovePatches([1, 2], RULES.length, 'down');
    expect(apply(RULES, patches)).toEqual(['A', 'D', 'B', 'C', 'E']);
  });

  it('moves a non-contiguous selection as a block spanning its own min..max range', () => {
    // Selecting B and D (indices 1, 3) and moving up: the whole [1..3] span
    // (including the unselected C) shifts up together, matching the visual
    // "everything from the topmost to the bottommost selected row" block.
    const patches = buildBatchMovePatches([1, 3], RULES.length, 'up');
    expect(apply(RULES, patches)).toEqual(['B', 'C', 'D', 'A', 'E']);
  });

  it('is a no-op moving up when the selection already starts at index 0', () => {
    expect(buildBatchMovePatches([0, 1], RULES.length, 'up')).toEqual([]);
  });

  it('is a no-op moving down when the selection already ends at the last index', () => {
    expect(buildBatchMovePatches([3, 4], RULES.length, 'down')).toEqual([]);
  });

  it('returns no patches for an empty selection', () => {
    expect(buildBatchMovePatches([], RULES.length, 'up')).toEqual([]);
  });

  it('does not require the input indices to already be sorted', () => {
    const patches = buildBatchMovePatches([2, 1], RULES.length, 'up');
    expect(apply(RULES, patches)).toEqual(['B', 'C', 'A', 'D', 'E']);
  });
});

describe('buildBatchCopyPatches', () => {
  const RULES = ['A', 'B', 'C', 'D', 'E'];

  it('duplicates a single selected row immediately after itself', () => {
    const patches = buildBatchCopyPatches([1], RULES);
    expect(apply(RULES, patches)).toEqual(['A', 'B', 'B', 'C', 'D', 'E']);
  });

  it('duplicates a non-contiguous multi-row selection right after the last selected row, preserving relative order', () => {
    const patches = buildBatchCopyPatches([1, 3], RULES);
    expect(apply(RULES, patches)).toEqual(['A', 'B', 'C', 'D', 'B', 'D', 'E']);
  });

  it('does not depend on the input indices already being sorted', () => {
    const patches = buildBatchCopyPatches([3, 1], RULES);
    expect(apply(RULES, patches)).toEqual(['A', 'B', 'C', 'D', 'B', 'D', 'E']);
  });

  it('duplicating the last row appends the copy at the very end', () => {
    const patches = buildBatchCopyPatches([4], RULES);
    expect(apply(RULES, patches)).toEqual(['A', 'B', 'C', 'D', 'E', 'E']);
  });

  it('returns no patches for an empty selection', () => {
    expect(buildBatchCopyPatches([], RULES)).toEqual([]);
  });
});

describe('buildBatchDeletePatches', () => {
  it('removes every selected row, ending with the correct survivors', () => {
    const patches = buildBatchDeletePatches([1, 3]);
    expect(apply(['A', 'B', 'C', 'D', 'E'], patches)).toEqual(['A', 'C', 'E']);
  });

  it('orders the patches in descending index — ascending would corrupt later paths as earlier removals shift indices', () => {
    const patches = buildBatchDeletePatches([1, 3, 0]);
    expect(patches.map((p) => p.path[p.path.length - 1])).toEqual([3, 1, 0]);
  });

  it('returns no patches for an empty selection', () => {
    expect(buildBatchDeletePatches([])).toEqual([]);
  });
});

describe('buildBatchReplaceTargetPatches', () => {
  const DOMAIN_SUFFIX: RuleTypeSpec = {
    type: 'DOMAIN-SUFFIX',
    payloadKind: 'domain-suffix',
    needsPayload: true,
    params: [],
    safety: 'safe',
  };
  const IP_CIDR: RuleTypeSpec = {
    type: 'IP-CIDR',
    payloadKind: 'ipcidr',
    needsPayload: true,
    params: ['no-resolve', 'src'],
    safety: 'safe',
  };
  const SUB_RULE: RuleTypeSpec = {
    type: 'SUB-RULE',
    payloadKind: 'sub-rule',
    needsPayload: false,
    params: [],
    safety: 'safe',
  };
  const MATCH: RuleTypeSpec = {
    type: 'MATCH',
    payloadKind: 'none',
    needsPayload: false,
    params: [],
    safety: 'safe',
  };
  const CATALOG: readonly RuleTypeSpec[] = [DOMAIN_SUFFIX, IP_CIDR, SUB_RULE, MATCH];

  it('rewrites the target of every selected recognised rule, keeping type/payload/params intact', () => {
    const rules = [
      'DOMAIN-SUFFIX,a.com,DIRECT',
      'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
      'MATCH,DIRECT',
    ];
    const patches = buildBatchReplaceTargetPatches([0, 1, 2], rules, CATALOG, 'PROXY');
    expect(apply(rules, patches)).toEqual([
      'DOMAIN-SUFFIX,a.com,PROXY',
      'IP-CIDR,10.0.0.0/8,PROXY,no-resolve',
      'MATCH,PROXY',
    ]);
  });

  it('skips an unrecognised (raw) rule rather than guessing at its structure', () => {
    const rules = ['AND,(a,b),PROXY'];
    const patches = buildBatchReplaceTargetPatches([0], rules, CATALOG, 'REJECT');
    expect(patches).toEqual([]);
  });

  it('skips a SUB-RULE row: its target names a sub-rule group, not an outbound policy', () => {
    const rules = ['SUB-RULE,ads-block'];
    const patches = buildBatchReplaceTargetPatches([0], rules, CATALOG, 'REJECT');
    expect(patches).toEqual([]);
  });

  it('applies to the recognised rows in a mixed selection while skipping the raw/SUB-RULE ones', () => {
    const rules = [
      'DOMAIN-SUFFIX,a.com,DIRECT',
      'SUB-RULE,ads-block',
      'AND,(a,b),PROXY',
      'MATCH,DIRECT',
    ];
    const patches = buildBatchReplaceTargetPatches([0, 1, 2, 3], rules, CATALOG, 'REJECT');
    expect(apply(rules, patches)).toEqual([
      'DOMAIN-SUFFIX,a.com,REJECT',
      'SUB-RULE,ads-block',
      'AND,(a,b),PROXY',
      'MATCH,REJECT',
    ]);
  });
});
