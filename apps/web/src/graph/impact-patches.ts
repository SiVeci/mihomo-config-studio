import type { ConfigPath, Entity, IssueFix, Reference } from '../worker/protocol.js';

/**
 * Builds the `applyBatch` patches for deleting an entity by replacing every
 * one of its `replaceable` references with `newTarget` (v0.4.0 #11,
 * FR-REL-03 UI). Never touches `cascading` — replacing (rather than
 * removing) a reference can never leave an owner empty, so nothing needs to
 * cascade in this path; the dialog only offers this exit when `cascading`
 * is empty (see `DeleteImpactDialog`'s own doc comment for why).
 */
export function buildReplacePatches(
  documentValue: unknown,
  entityPath: ConfigPath,
  replaceable: readonly Reference[],
  newTarget: string,
): IssueFix[] {
  const patches: IssueFix[] = [];
  for (const ref of replaceable) {
    if (ref.referenceType === 'seq-item') {
      patches.push({ kind: 'set', path: ref.path, value: newTarget });
    } else if (ref.referenceType === 'scalar-fragment' && ref.fragment) {
      const current = readPath(documentValue, ref.path);
      if (typeof current === 'string') {
        const spliced =
          current.slice(0, ref.fragment.start) + newTarget + current.slice(ref.fragment.end);
        patches.push({ kind: 'set', path: ref.path, value: spliced });
      }
    }
    // `map-key` is never produced by `referencesTo` (see `Reference`'s own doc comment) — no case needed.
  }
  patches.push({ kind: 'remove', path: entityPath });
  return patches;
}

/**
 * Builds the `applyBatch` patches for deleting an entity together with
 * every entity `analyzeImpact` classified as `cascading` (would otherwise
 * be left with an empty `proxies`/`use`). No replacement target exists in
 * this path, so anything in `replaceable` is *removed* rather than
 * rewritten: a `seq-item` reference drops that one array item; a
 * `scalar-fragment` reference (a rule's target/payload token) cannot be
 * partially removed — the whole rule line it lives in is dropped instead,
 * since a rule with no valid target is not a state this app can leave the
 * document in.
 *
 * Every deletion path is grouped by its parent container, and each group is
 * ordered by descending index before being turned into `remove` patches —
 * the same problem v0.4.0 #10's `buildBatchDeletePatches` solves for a
 * single array, generalised here to possibly-several unrelated arrays at
 * once (e.g. one root-level `proxy-groups` removal alongside a nested
 * `proxy-groups[1].proxies` removal). Grouping first, rather than a single
 * global sort comparator, is deliberate: a comparator that returns "equal"
 * for two paths in different (incomparable) arrays is not transitive across
 * a third path that *does* share a parent with one of them, which makes
 * `Array#sort`'s result depend on the engine's algorithm instead of being
 * well-defined — grouping sidesteps that instead of relying on a
 * borderline-correct comparator.
 */
export function buildCascadeDeletePatches(
  entityPath: ConfigPath,
  replaceable: readonly Reference[],
  cascading: readonly Entity[],
): IssueFix[] {
  const paths: ConfigPath[] = [entityPath];
  for (const ref of replaceable) {
    if (ref.referenceType === 'seq-item' || ref.referenceType === 'scalar-fragment') {
      paths.push(ref.path);
    }
  }
  for (const entity of cascading) {
    // Every cascading entity is a proxy-group (only a `proxies`/`use` owner
    // can become empty) — its own deletion path is the array item one level
    // above the `name` field `sourcePath` addresses.
    paths.push(entity.sourcePath.slice(0, -1));
  }

  return sortForDeletion(paths).map((path) => ({ kind: 'remove', path }));
}

function sortForDeletion(paths: readonly ConfigPath[]): ConfigPath[] {
  const groups = new Map<string, ConfigPath[]>();
  const groupOrder: string[] = [];
  for (const path of paths) {
    const parentKey = JSON.stringify(path.slice(0, -1));
    let group = groups.get(parentKey);
    if (!group) {
      group = [];
      groups.set(parentKey, group);
      groupOrder.push(parentKey);
    }
    group.push(path);
  }

  const result: ConfigPath[] = [];
  for (const key of groupOrder) {
    const group = groups.get(key) as ConfigPath[];
    group.sort((a, b) => {
      const aLast = a[a.length - 1];
      const bLast = b[b.length - 1];
      return typeof aLast === 'number' && typeof bLast === 'number' ? bLast - aLast : 0;
    });
    result.push(...group);
  }
  return result;
}

function readPath(value: unknown, path: ConfigPath): unknown {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}
