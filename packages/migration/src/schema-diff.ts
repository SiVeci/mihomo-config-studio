import { resolveRef, type JsonSchema } from '@mcs/schema-core';

/**
 * Structural comparison of two Schema versions — never a comparison against
 * a real document. "Default value changed" only ever reports the two
 * Schema-declared `default`s; it never reads a user document's current
 * value for that field (NFR-SEC-03). This is one of two sources
 * FR-UPD-06's upgrade preview draws on — the other, "migration diff", comes
 * from a `MigrationPlan.operations` (declarative rules, `load.ts`); the two
 * are never derived from one another.
 */
export interface SchemaDiffEntry {
  readonly path: string;
}

export interface DefaultChangedEntry {
  readonly path: string;
  readonly oldDefault: unknown;
  readonly newDefault: unknown;
}

export interface SchemaDiff {
  readonly added: readonly SchemaDiffEntry[];
  /** Fields whose `deprecated` flag became `true` in the new schema — not every already-deprecated field, only newly so. */
  readonly deprecated: readonly SchemaDiffEntry[];
  readonly defaultChanged: readonly DefaultChangedEntry[];
}

export class SchemaDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaDiffError';
  }
}

/**
 * A Schema comes from a Bundle that, even signed and verified, could still
 * be maliciously or accidentally deeply nested — walking it must not be
 * able to wedge the UI thread (same reasoning as `condition.ts`'s
 * `MAX_CONDITION_DEPTH`, `ref.ts`'s `MAX_REF_HOPS`, `yaml-engine/limits.ts`).
 */
const MAX_DIFF_DEPTH = 32;
const MAX_DIFF_NODES = 20_000;

interface WalkState {
  nodeCount: number;
}

interface DiffAccumulator {
  readonly added: SchemaDiffEntry[];
  readonly deprecated: SchemaDiffEntry[];
  readonly defaultChanged: DefaultChangedEntry[];
}

export function diffSchemas(oldSchema: JsonSchema, newSchema: JsonSchema): SchemaDiff {
  const out: DiffAccumulator = { added: [], deprecated: [], defaultChanged: [] };
  const state: WalkState = { nodeCount: 0 };
  walkNode(oldSchema, oldSchema, newSchema, newSchema, '$', 0, state, out);
  return out;
}

function touchBudget(depth: number, state: WalkState): void {
  state.nodeCount += 1;
  if (depth > MAX_DIFF_DEPTH || state.nodeCount > MAX_DIFF_NODES) {
    throw new SchemaDiffError('Schema exceeds the diff traversal depth/node budget.');
  }
}

/**
 * Dispatches on the new node's own shape. A oneOf (discriminated union,
 * ADR-019) is diffed branch-by-branch, matched by discriminator value where
 * one can be found — branches are never pooled into one flat property set,
 * or a field named the same in two unrelated branches would be conflated.
 */
function walkNode(
  oldNode: JsonSchema | undefined,
  oldRoot: JsonSchema,
  newNode: JsonSchema | undefined,
  newRoot: JsonSchema,
  path: string,
  depth: number,
  state: WalkState,
  out: DiffAccumulator,
): void {
  touchBudget(depth, state);
  if (!newNode) return;

  if (newNode.oneOf || oldNode?.oneOf) {
    walkOneOf(oldNode, oldRoot, newNode, newRoot, path, depth, state, out);
    return;
  }

  walkProperties(oldNode, oldRoot, newNode, newRoot, path, depth, state, out);

  if (newNode.items) {
    walkNode(oldNode?.items, oldRoot, newNode.items, newRoot, `${path}[]`, depth + 1, state, out);
  }
}

function walkOneOf(
  oldNode: JsonSchema | undefined,
  oldRoot: JsonSchema,
  newNode: JsonSchema,
  newRoot: JsonSchema,
  path: string,
  depth: number,
  state: WalkState,
  out: DiffAccumulator,
): void {
  const oldBranches = oldNode?.oneOf ?? [];
  const newBranches = newNode.oneOf ?? [];

  const oldByDiscriminator = new Map<string, JsonSchema>();
  oldBranches.forEach((branch, index) => {
    const props = collectProperties(branch, oldRoot, depth + 1, state);
    oldByDiscriminator.set(branchDiscriminator(props, index).label, branch);
  });

  newBranches.forEach((branch, index) => {
    const props = collectProperties(branch, newRoot, depth + 1, state);
    const discriminator = branchDiscriminator(props, index);
    const matchedOld = oldByDiscriminator.get(discriminator.label);
    walkProperties(
      matchedOld,
      oldRoot,
      branch,
      newRoot,
      `${path}<${discriminator.label}>`,
      depth + 1,
      state,
      out,
      discriminator.fieldName,
    );
  });
}

interface BranchDiscriminator {
  readonly label: string;
  /** The property name itself (e.g. `type`), omitted when no candidate was found. */
  readonly fieldName?: string;
}

/** The first property with a `const` or single-value `enum` (ADR-019's own discriminator-candidate rule), or a positional fallback so every branch still gets a distinct key. */
function branchDiscriminator(
  properties: Record<string, JsonSchema>,
  index: number,
): BranchDiscriminator {
  for (const [name, propSchema] of Object.entries(properties)) {
    if (propSchema.const !== undefined) {
      return { label: `${name}=${String(propSchema.const)}`, fieldName: name };
    }
    if (propSchema.enum && propSchema.enum.length === 1) {
      return { label: `${name}=${String(propSchema.enum[0])}`, fieldName: name };
    }
  }
  return { label: `#${index}` };
}

function walkProperties(
  oldNode: JsonSchema | undefined,
  oldRoot: JsonSchema,
  newNode: JsonSchema,
  newRoot: JsonSchema,
  path: string,
  depth: number,
  state: WalkState,
  out: DiffAccumulator,
  /** The discriminator field, if any (`branchDiscriminator`'s `fieldName`) — excluded from diffing: ADR-019 already treats it as a selector, not an ordinary field, and reporting "field `type` was added" on a brand-new branch is noise, not signal. */
  excludeField?: string,
): void {
  const oldProps = oldNode ? collectProperties(oldNode, oldRoot, depth, state) : {};
  const newProps = collectProperties(newNode, newRoot, depth, state);

  for (const [key, newPropSchema] of Object.entries(newProps)) {
    if (key === excludeField) continue;
    const fieldPath = `${path}.${key}`;
    const oldPropSchema = oldProps[key];
    const isNew = !oldPropSchema;

    if (isNew) {
      out.added.push({ path: fieldPath });
    }

    if (newPropSchema.deprecated === true && oldPropSchema?.deprecated !== true) {
      out.deprecated.push({ path: fieldPath });
    }

    if (jsonNotEqual(oldPropSchema?.default, newPropSchema.default)) {
      out.defaultChanged.push({
        path: fieldPath,
        oldDefault: oldPropSchema?.default,
        newDefault: newPropSchema.default,
      });
    }

    // A brand-new field's own nested structure is already fully described
    // by the single `added` entry above — recursing further would just
    // relist every one of its children as individually "added" too.
    if (!isNew) {
      walkNode(oldPropSchema, oldRoot, newPropSchema, newRoot, fieldPath, depth + 1, state, out);
    }
  }
}

/**
 * Own-properties plus `allOf` members flattened in (ADR-019: branches share
 * fields via `$defs` + `allOf`), each `$ref` resolved through
 * `@mcs/schema-core`'s own local-only resolver — remote refs stay refused
 * exactly as they are everywhere else this Schema shape is walked.
 */
function collectProperties(
  schema: JsonSchema,
  root: JsonSchema,
  depth: number,
  state: WalkState,
): Record<string, JsonSchema> {
  touchBudget(depth, state);
  const resolved = resolveRef(schema, root);

  const result: Record<string, JsonSchema> = { ...resolved.properties };
  for (const member of resolved.allOf ?? []) {
    Object.assign(result, collectProperties(member, root, depth + 1, state));
  }
  return result;
}

function jsonNotEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}
