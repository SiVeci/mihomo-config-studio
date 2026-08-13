import { EntityRegistry, HistoryStack } from '@mcs/config-model';
import { readFixture } from '@mcs/test-fixtures';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import { ReferenceIndex } from './reference-index.js';

const COMPREHENSIVE = readFixture('yaml/comprehensive.yaml');

function parse(source: string): MihomoYamlDocument {
  const result = MihomoYamlDocument.parse(source);
  if (!result.document) {
    throw new Error(
      `fixture failed to parse: ${result.issues.map((i) => i.messageKey).join('; ')}`,
    );
  }
  return result.document;
}

/**
 * `config-model`'s `HistoryStack` cannot import `@mcs/graph` to drive this
 * scenario itself: `graph` already depends on `config-model` (for `Entity`
 * and `parseRuleLine`), so the reverse edge would be a circular TypeScript
 * project reference and `tsc -b` would refuse to build. `graph` depending on
 * `config-model` the other way round is fine, so the end-to-end proof that a
 * real cascading rename collapses into a single undo step lives here instead
 * — `history.test.ts` covers the same mechanism generically, with hand-rolled
 * multi-path edits standing in for what `ReferenceIndex.rename()` does below.
 */
describe('cascading rename as a single history item (FR-PROJ-04, FR-REL-02)', () => {
  it('undoes a whole cascading rename — the declaration and every reference — in one step', () => {
    const document = parse(COMPREHENSIVE);
    const before = document.toText();

    const registry = new EntityRegistry();
    const index = new ReferenceIndex();
    const entities = registry.extract(document);
    index.rebuild(document, entities);
    const proxy = entities.find((e) => e.kind === 'proxy-group' && e.serializedName === 'PROXY');
    if (!proxy) throw new Error('fixture missing expected PROXY group');
    // The rename must touch more than the declaration for this to be a
    // meaningful test of cascading (not single-line) undo.
    expect(index.referencesTo(proxy.id).length).toBeGreaterThan(0);

    const stack = new HistoryStack();
    stack.record(document, 'rename-entity', () => {
      index.rename(document, proxy.id, 'PROXY-MAIN');
    });

    expect(document.toText()).not.toBe(before);
    expect(document.toText()).toContain('name: PROXY-MAIN');
    expect(stack.canRedo).toBe(false);

    // However many lines the cascade touched, one undo() returns to the
    // exact pre-rename text — that is the whole point of wrapping the rename
    // in a single record() call rather than one per document.* call.
    expect(stack.undo()).toBe(before);
    expect(stack.canUndo).toBe(false);
  });
});
