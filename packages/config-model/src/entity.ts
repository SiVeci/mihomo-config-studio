import type { ConfigPath, MihomoYamlDocument } from '@mcs/yaml-engine';

/**
 * `config/config.go#parseProxies` (MetaCubeX/mihomo v1.19.29) reserves these
 * six unconditionally before user config is parsed; a proxy or group reusing
 * one of these names is rejected upstream, so they are safe to treat as
 * permanent entities.
 */
const UNCONDITIONAL_BUILTINS = [
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'COMPATIBLE',
  'PASS',
  'PASS-RULE',
] as const;

/**
 * Also upstream-reserved, but only auto-created when no `proxy-groups[]`
 * entry is itself named GLOBAL (`hasGlobal` in `parseProxies`); a
 * user-defined GLOBAL group is used in its place.
 */
const CONDITIONAL_GLOBAL = 'GLOBAL';

export type EntityKind =
  'proxy' | 'proxy-provider' | 'proxy-group' | 'rule-provider' | 'rule' | 'sub-rule' | 'builtin';

/**
 * `id` is assigned by `EntityRegistry` and stays fixed across renames
 * (FR-REL-01); it is never written back into the document. `sourcePath`
 * addresses the scalar carrying `serializedName` — a map key or a
 * `name`/rule-line scalar — so callers can rename it directly with
 * `renameKeyIn`/`setScalarIn`. Built-in targets are not part of the
 * document and use an empty `sourcePath`.
 */
export interface Entity {
  readonly id: string;
  readonly kind: EntityKind;
  readonly serializedName: string;
  readonly sourcePath: ConfigPath;
}

interface Slot {
  readonly kind: EntityKind;
  readonly serializedName: string;
  readonly sourcePath: ConfigPath;
  /**
   * Stable across a pure rename of this slot (built from kind + positional
   * index, never from the mutable name/key text itself). Not stable across
   * insertion or deletion elsewhere in the same container — a structural
   * edit may reassign ids for shifted siblings, which is why consumers that
   * need that guarantee (the reference index) rebuild wholesale afterwards
   * instead of relying on incremental identity.
   */
  readonly slotKey: string;
}

/**
 * Reconciles freshly extracted entities against previously assigned ids so a
 * rename never changes `id`, minting fresh `kind:counter` ids for anything
 * not seen before and dropping slots that no longer exist.
 */
export class EntityRegistry {
  readonly #counters = new Map<EntityKind, number>();
  readonly #bySlot = new Map<string, Entity>();

  /** Re-extract from the current document state and return every entity. */
  extract(document: MihomoYamlDocument): Entity[] {
    const seen = new Set<string>();
    const result: Entity[] = [];

    for (const slot of extractSlots(document)) {
      seen.add(slot.slotKey);
      const existing = this.#bySlot.get(slot.slotKey);
      const entity: Entity = existing
        ? { ...existing, serializedName: slot.serializedName, sourcePath: slot.sourcePath }
        : {
            id: this.#nextId(slot.kind),
            kind: slot.kind,
            serializedName: slot.serializedName,
            sourcePath: slot.sourcePath,
          };
      this.#bySlot.set(slot.slotKey, entity);
      result.push(entity);
    }

    for (const [slotKey] of [...this.#bySlot]) {
      if (!seen.has(slotKey)) this.#bySlot.delete(slotKey);
    }

    return result;
  }

  #nextId(kind: EntityKind): string {
    const next = this.#counters.get(kind) ?? 0;
    this.#counters.set(kind, next + 1);
    return `${kind}:${next}`;
  }
}

function extractSlots(document: MihomoYamlDocument): Slot[] {
  const proxyGroups = extractNamedArray(document, 'proxy-groups', 'proxy-group');
  const hasUserGlobal = proxyGroups.some((slot) => slot.serializedName === CONDITIONAL_GLOBAL);

  return [
    ...extractNamedArray(document, 'proxies', 'proxy'),
    ...proxyGroups,
    ...extractKeyedMap(document, 'proxy-providers', 'proxy-provider'),
    ...extractKeyedMap(document, 'rule-providers', 'rule-provider'),
    ...extractStringArray(document, 'rules', 'rule'),
    ...extractSubRules(document),
    ...extractBuiltins(hasUserGlobal),
  ];
}

/** `proxies[].name` / `proxy-groups[].name`. */
function extractNamedArray(document: MihomoYamlDocument, key: string, kind: EntityKind): Slot[] {
  const raw = document.getIn([key]);
  if (!Array.isArray(raw)) return [];
  const out: Slot[] = [];
  raw.forEach((item, index) => {
    const name = isRecord(item) ? item.name : undefined;
    if (typeof name !== 'string' || name === '') return;
    out.push({
      kind,
      serializedName: name,
      sourcePath: [key, index, 'name'],
      slotKey: `${kind}#${index}`,
    });
  });
  return out;
}

/** `proxy-providers.<key>` / `rule-providers.<key>`. */
function extractKeyedMap(document: MihomoYamlDocument, key: string, kind: EntityKind): Slot[] {
  const raw = document.getIn([key]);
  if (!isRecord(raw)) return [];
  return Object.keys(raw).map((name, index) => ({
    kind,
    serializedName: name,
    sourcePath: [key, name],
    slotKey: `${kind}#${index}`,
  }));
}

/** `rules[]`: each array item is itself the entity's identity. */
function extractStringArray(document: MihomoYamlDocument, key: string, kind: EntityKind): Slot[] {
  const raw = document.getIn([key]);
  if (!Array.isArray(raw)) return [];
  const out: Slot[] = [];
  raw.forEach((item, index) => {
    if (typeof item !== 'string' || item === '') return;
    out.push({ kind, serializedName: item, sourcePath: [key, index], slotKey: `${kind}#${index}` });
  });
  return out;
}

/** `sub-rules.<key>[]`: same shape as `rules[]`, nested one level under each group's key. */
function extractSubRules(document: MihomoYamlDocument): Slot[] {
  const raw = document.getIn(['sub-rules']);
  if (!isRecord(raw)) return [];
  const out: Slot[] = [];
  Object.keys(raw).forEach((groupName, groupIndex) => {
    const items = raw[groupName];
    if (!Array.isArray(items)) return;
    items.forEach((item, itemIndex) => {
      if (typeof item !== 'string' || item === '') return;
      out.push({
        kind: 'sub-rule',
        serializedName: item,
        sourcePath: ['sub-rules', groupName, itemIndex],
        slotKey: `sub-rule#${groupIndex}.${itemIndex}`,
      });
    });
  });
  return out;
}

function extractBuiltins(hasUserGlobal: boolean): Slot[] {
  const names: readonly string[] = hasUserGlobal
    ? UNCONDITIONAL_BUILTINS
    : [...UNCONDITIONAL_BUILTINS, CONDITIONAL_GLOBAL];
  return names.map((name) => ({
    kind: 'builtin',
    serializedName: name,
    sourcePath: [],
    slotKey: `builtin:${name}`,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
