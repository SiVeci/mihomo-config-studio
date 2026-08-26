import type { Entity, EntityKind } from '@mcs/config-model';
import { parseRuleLine } from '@mcs/config-model';
import type { ConfigPath, MihomoYamlDocument } from '@mcs/yaml-engine';

export type ReferenceType = 'map-key' | 'seq-item' | 'scalar-fragment';

/**
 * An edge from one entity to another, found by scanning the document for a
 * name that matches an existing entity. `map-key` is never produced here —
 * an entity's own map-key declaration (proxy-provider/rule-provider) is
 * rewritten directly from `Entity.sourcePath` in `rename()`, not discovered
 * by scanning — but the type still names that rewrite technique for parity
 * with the other two, which is why it is part of the union.
 */
export interface Reference {
  readonly fromId: string;
  readonly toId: string;
  readonly path: ConfigPath;
  readonly referenceType: ReferenceType;
  /** Set only for `scalar-fragment`: the referenced span within the scalar at `path`. */
  readonly fragment?: { readonly start: number; readonly end: number };
}

export type GraphErrorCode =
  'GRAPH_ENTITY_NOT_FOUND' | 'GRAPH_NAME_CONFLICT' | 'GRAPH_RENAME_UNSUPPORTED';

/** Errors never embed configuration values (NFR-SEC-03): only the entity kind/id. */
export class GraphError extends Error {
  readonly code: GraphErrorCode;
  readonly entityId: string;

  constructor(code: GraphErrorCode, message: string, entityId: string) {
    super(message);
    this.name = 'GraphError';
    this.code = code;
    this.entityId = entityId;
  }
}

const RENAMABLE_KINDS = new Set<EntityKind>([
  'proxy',
  'proxy-group',
  'proxy-provider',
  'rule-provider',
]);
const MAP_KEY_KINDS = new Set<EntityKind>(['proxy-provider', 'rule-provider']);
const PROXY_TARGET_KINDS: readonly EntityKind[] = ['proxy', 'proxy-group', 'builtin'];

type Lookup = Map<EntityKind, Map<string, string>>;

export class ReferenceIndex {
  #entities: readonly Entity[] = [];
  #entitiesById = new Map<string, Entity>();
  #referencesToId = new Map<string, Reference[]>();

  /**
   * Re-derives the index from the current document state. Structural edits
   * (`appendIn` / `deleteIn` / `moveSeqItem`), and any edit that changes the
   * length of a scalar another reference's offset falls inside, invalidate
   * this index — callers must re-extract entities and call this again
   * rather than expect incremental maintenance. `rename()` itself is safe
   * to call once against a freshly built index; rebuild before renaming a
   * second entity in the same document.
   */
  rebuild(document: MihomoYamlDocument, entities: readonly Entity[]): void {
    this.#entities = entities;
    this.#entitiesById = new Map(entities.map((entity) => [entity.id, entity]));
    this.#referencesToId = new Map();
    for (const ref of collectReferences(document, entities)) {
      const existing = this.#referencesToId.get(ref.toId);
      if (existing) existing.push(ref);
      else this.#referencesToId.set(ref.toId, [ref]);
    }
  }

  entity(entityId: string): Entity | undefined {
    return this.#entitiesById.get(entityId);
  }

  referencesTo(entityId: string): readonly Reference[] {
    return this.#referencesToId.get(entityId) ?? [];
  }

  /** Every reference in the document, regardless of target — `layout.ts` (v0.4.0 #12) needs the whole edge set, not one entity's incoming edges. */
  allReferences(): readonly Reference[] {
    return [...this.#referencesToId.values()].flat();
  }

  /**
   * Renames `entityId` to `newName`: rewrites its own declaration and every
   * reference to it. Throws before touching the document when the entity is
   * unknown, of a kind that has no name to rename, or when `newName`
   * collides with another entity of the same kind — no half-done rewrite.
   */
  rename(document: MihomoYamlDocument, entityId: string, newName: string): void {
    const entity = this.entity(entityId);
    if (!entity) {
      throw new GraphError('GRAPH_ENTITY_NOT_FOUND', 'No entity exists with this id.', entityId);
    }
    if (!RENAMABLE_KINDS.has(entity.kind)) {
      throw new GraphError(
        'GRAPH_RENAME_UNSUPPORTED',
        `Entities of kind "${entity.kind}" cannot be renamed.`,
        entityId,
      );
    }
    const conflict = this.#entities.some(
      (candidate) =>
        candidate.id !== entity.id &&
        candidate.kind === entity.kind &&
        candidate.serializedName === newName,
    );
    if (conflict) {
      throw new GraphError(
        'GRAPH_NAME_CONFLICT',
        `Another ${entity.kind} already uses this name.`,
        entityId,
      );
    }

    if (MAP_KEY_KINDS.has(entity.kind)) {
      const mapPath = entity.sourcePath.slice(0, -1);
      const oldKey = String(entity.sourcePath[entity.sourcePath.length - 1]);
      document.renameKeyIn(mapPath, oldKey, newName);
    } else {
      document.setScalarIn(entity.sourcePath, newName);
    }

    // payload and target always resolve to disjoint entity kinds (see
    // referenceKindsForField), so a single rule line never carries two
    // fragments referencing the same entity — each `setScalarIn` below is
    // safe to apply independently without its offset going stale from a
    // sibling edit on the same line within this loop.
    for (const ref of this.referencesTo(entityId)) {
      if (ref.referenceType === 'seq-item') {
        document.setScalarIn(ref.path, newName);
        continue;
      }
      if (ref.referenceType === 'scalar-fragment' && ref.fragment) {
        const line = document.getIn(ref.path);
        if (typeof line !== 'string') continue;
        const rewritten =
          line.slice(0, ref.fragment.start) + newName + line.slice(ref.fragment.end);
        document.setScalarIn(ref.path, rewritten);
      }
    }
  }
}

function collectReferences(document: MihomoYamlDocument, entities: readonly Entity[]): Reference[] {
  const lookup = buildLookup(entities);
  const refs: Reference[] = [];

  collectGroupReferences(document, entities, lookup, refs);
  collectRuleReferences(document, ['rules'], lookup, refs, (index) =>
    entityAtIndex(entities, 'rule', index),
  );
  collectSubRuleReferences(document, entities, lookup, refs);

  return refs;
}

function collectGroupReferences(
  document: MihomoYamlDocument,
  entities: readonly Entity[],
  lookup: Lookup,
  refs: Reference[],
): void {
  const groups = document.getIn(['proxy-groups']);
  if (!Array.isArray(groups)) return;

  groups.forEach((group, groupIndex) => {
    const fromId = entityAtIndex(entities, 'proxy-group', groupIndex);
    if (!fromId || !isRecord(group)) return;

    collectSeqRefs(
      group.proxies,
      ['proxy-groups', groupIndex, 'proxies'],
      fromId,
      PROXY_TARGET_KINDS,
      lookup,
      refs,
    );
    collectSeqRefs(
      group.use,
      ['proxy-groups', groupIndex, 'use'],
      fromId,
      ['proxy-provider'],
      lookup,
      refs,
    );
  });
}

function collectSeqRefs(
  items: unknown,
  basePath: ConfigPath,
  fromId: string,
  kinds: readonly EntityKind[],
  lookup: Lookup,
  refs: Reference[],
): void {
  if (!Array.isArray(items)) return;
  items.forEach((item, itemIndex) => {
    if (typeof item !== 'string') return;
    const toId = lookupName(lookup, kinds, item);
    if (!toId) return;
    refs.push({ fromId, toId, path: [...basePath, itemIndex], referenceType: 'seq-item' });
  });
}

function collectRuleReferences(
  document: MihomoYamlDocument,
  path: ConfigPath,
  lookup: Lookup,
  refs: Reference[],
  fromIdAt: (index: number) => string | null,
): void {
  const rules = document.getIn(path);
  if (!Array.isArray(rules)) return;
  rules.forEach((line, index) => {
    if (typeof line !== 'string') return;
    const fromId = fromIdAt(index);
    if (!fromId) return;
    collectFromRuleLine(line, [...path, index], fromId, lookup, refs);
  });
}

function collectSubRuleReferences(
  document: MihomoYamlDocument,
  entities: readonly Entity[],
  lookup: Lookup,
  refs: Reference[],
): void {
  const subRules = document.getIn(['sub-rules']);
  if (!isRecord(subRules)) return;

  for (const groupName of Object.keys(subRules)) {
    const items = subRules[groupName];
    if (!Array.isArray(items)) continue;
    items.forEach((line, index) => {
      if (typeof line !== 'string') return;
      const fromId = entities.find(
        (e) => e.kind === 'sub-rule' && e.sourcePath[1] === groupName && e.sourcePath[2] === index,
      )?.id;
      if (!fromId) return;
      collectFromRuleLine(line, ['sub-rules', groupName, index], fromId, lookup, refs);
    });
  }
}

function collectFromRuleLine(
  line: string,
  path: ConfigPath,
  fromId: string,
  lookup: Lookup,
  refs: Reference[],
): void {
  const parsed = parseRuleLine(line);
  const fields = [
    ['payload', parsed.payload],
    ['target', parsed.target],
  ] as const;

  for (const [field, fragment] of fields) {
    if (!fragment) continue;
    const kinds = referenceKindsForField(parsed.type, field);
    const toId = lookupName(lookup, kinds, fragment.value);
    if (!toId) continue;
    refs.push({
      fromId,
      toId,
      path,
      referenceType: 'scalar-fragment',
      fragment: { start: fragment.start, end: fragment.end },
    });
  }
}

/**
 * `RULE-SET`'s payload names a rule-provider; every other type's payload is
 * a matching criterion (domain/IP/process/...), not a reference. Every
 * type's target names a proxy/proxy-group/builtin, except `SUB-RULE`,
 * whose target names a sub-rule group. That group is not modeled as its own
 * entity (only its individual lines are), so no reference is produced for
 * it — a documented gap, not a silent one.
 */
function referenceKindsForField(
  ruleType: string,
  field: 'payload' | 'target',
): readonly EntityKind[] {
  if (field === 'target') {
    return ruleType === 'SUB-RULE' ? [] : PROXY_TARGET_KINDS;
  }
  return ruleType === 'RULE-SET' ? ['rule-provider'] : [];
}

function entityAtIndex(
  entities: readonly Entity[],
  kind: EntityKind,
  index: number,
): string | null {
  return entities.find((e) => e.kind === kind && e.sourcePath[1] === index)?.id ?? null;
}

function buildLookup(entities: readonly Entity[]): Lookup {
  const lookup: Lookup = new Map();
  for (const entity of entities) {
    let byName = lookup.get(entity.kind);
    if (!byName) {
      byName = new Map();
      lookup.set(entity.kind, byName);
    }
    byName.set(entity.serializedName, entity.id);
  }
  return lookup;
}

function lookupName(lookup: Lookup, kinds: readonly EntityKind[], name: string): string | null {
  for (const kind of kinds) {
    const id = lookup.get(kind)?.get(name);
    if (id) return id;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
