import type { SchemaModule } from '@mcs/schema-core';

import type { StoredBundle } from './store.js';

export type RegistryIssueCode =
  | 'REGISTRY_INVALID_MODULE_JSON'
  | 'REGISTRY_MISSING_DEPENDENCY'
  | 'REGISTRY_DEPENDENCY_CYCLE'
  | 'REGISTRY_NO_MATCHING_VERSION';

/**
 * Never carries module content (NFR-SEC-03) — `moduleId` is a structural
 * identifier (a declared `manifest.id`, or the bundle file path when a
 * module couldn't be parsed far enough to have one), the same "names not
 * values" line `SchemaIssue`/`ModuleShapeIssue` already draw.
 */
export interface RegistryIssue {
  readonly code: RegistryIssueCode;
  readonly moduleId: string;
}

export interface CreateRegistryOptions {
  /** The project's compatibility profile (a Mihomo version string). Omitted: skip mihomo-version filtering entirely. */
  readonly compatibilityProfile?: string;
}

export interface SchemaRegistry {
  /** Dependency-first order (a module never precedes anything it `dependsOn`). */
  modules(): readonly SchemaModule[];
  byRoot(root: readonly string[]): SchemaModule | undefined;
  resolve(id: string): SchemaModule | undefined;
  /** Every resolution failure encountered — a module that failed never appears in `modules()`/`byRoot()`/`resolve()`. */
  issues(): readonly RegistryIssue[];
}

/**
 * Discover and resolve the modules a verified Bundle carries.
 *
 * The input is a `StoredBundle` — already the product of `verifyBundle` —
 * not a filesystem scan: `packages/**` forbids `node:fs`, and "an
 * unverified module never reaches the Registry" is itself a security
 * boundary, not just a style choice. Each `bundle.files` entry is one
 * module serialised as a single JSON blob (matching `store.ts`'s
 * `builtinAsStoredBundle`); a module that fails to parse, fails a version
 * match, or sits in a broken dependency chain is dropped and recorded in
 * `issues()`, never silently ignored or half-included.
 */
export function createRegistry(
  bundle: StoredBundle,
  options: CreateRegistryOptions = {},
): SchemaRegistry {
  const issues: RegistryIssue[] = [];
  const parsed = parseModules(bundle, issues);
  const selected = selectVersions(parsed, options.compatibilityProfile, issues);
  const { valid, order } = resolveDependencyGraph(selected, issues);

  const ordered = order
    .map((id) => valid.get(id))
    .filter((module): module is SchemaModule => module !== undefined);

  return {
    modules: () => ordered,
    byRoot: (root) => ordered.find((module) => pathsEqual(module.manifest.root, root)),
    resolve: (id) => valid.get(id),
    issues: () => issues,
  };
}

function parseModules(bundle: StoredBundle, issues: RegistryIssue[]): SchemaModule[] {
  const decoder = new TextDecoder();
  const modules: SchemaModule[] = [];

  for (const [path, bytes] of bundle.files) {
    let value: unknown;
    try {
      value = JSON.parse(decoder.decode(bytes));
    } catch {
      issues.push({ code: 'REGISTRY_INVALID_MODULE_JSON', moduleId: path });
      continue;
    }
    if (!isModuleShape(value)) {
      issues.push({ code: 'REGISTRY_INVALID_MODULE_JSON', moduleId: path });
      continue;
    }
    modules.push(value);
  }

  return modules;
}

/** Minimal runtime check for the three fields every module has always had — `JSON.parse` returns `unknown`, TS cannot enforce this on Bundle content the way it does on in-repo modules. */
function isModuleShape(value: unknown): value is SchemaModule {
  if (
    !isRecord(value) ||
    !isRecord(value.manifest) ||
    !isRecord(value.schema) ||
    !isRecord(value.ui)
  ) {
    return false;
  }
  const manifest = value.manifest;
  if (typeof manifest.id !== 'string' || manifest.id === '') return false;
  if (typeof manifest.version !== 'string' || manifest.version === '') return false;
  if (
    !Array.isArray(manifest.root) ||
    !manifest.root.every((segment) => typeof segment === 'string')
  ) {
    return false;
  }
  return true;
}

/**
 * Same id present more than once: keep the highest SemVer `manifest.version`
 * among the candidates whose `mihomo.minVersion..maxTestedVersion` bounds
 * the given compatibility profile. No candidate qualifying is reported and
 * excluded outright — a silent fallback to some other version would let a
 * user believe an unsupported field combination is actually covered.
 */
function selectVersions(
  modules: readonly SchemaModule[],
  compatibilityProfile: string | undefined,
  issues: RegistryIssue[],
): Map<string, SchemaModule> {
  const byId = new Map<string, SchemaModule[]>();
  for (const module of modules) {
    const list = byId.get(module.manifest.id);
    if (list) list.push(module);
    else byId.set(module.manifest.id, [module]);
  }

  const selected = new Map<string, SchemaModule>();
  for (const [id, candidates] of byId) {
    const inRange =
      compatibilityProfile === undefined
        ? candidates
        : candidates.filter((module) =>
            versionInRange(compatibilityProfile, module.manifest.mihomo),
          );

    if (inRange.length === 0) {
      issues.push({ code: 'REGISTRY_NO_MATCHING_VERSION', moduleId: id });
      continue;
    }

    const [first, ...rest] = inRange;
    const best = first
      ? rest.reduce(
          (a, b) => (compareSemver(b.manifest.version, a.manifest.version) > 0 ? b : a),
          first,
        )
      : undefined;
    if (best) selected.set(id, best);
  }

  return selected;
}

function versionInRange(
  profile: string,
  mihomo: { minVersion?: string; maxTestedVersion?: string } | undefined,
): boolean {
  if (!mihomo) return true;
  if (mihomo.minVersion !== undefined && compareSemver(profile, mihomo.minVersion) < 0)
    return false;
  if (
    mihomo.maxTestedVersion !== undefined &&
    compareSemver(profile, mihomo.maxTestedVersion) > 0
  ) {
    return false;
  }
  return true;
}

/** MAJOR.MINOR.PATCH only; positive when `a` is newer than `b`. Deliberately not imported from `verify.ts` — that comparator is private and out of this slice's scope; this one is small enough to own locally. */
function compareSemver(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Gives `dependsOn` its first real consumer. Runs to a fixed point because
 * removing a module for one reason (a missing dependency) can turn a
 * previously-fine dependent into the same problem, and a removed cycle
 * member can do the same — so both checks repeat until a round removes
 * nothing. The module graph here is a handful of nodes at most (one per
 * installed Schema module), not attacker-scaled input, so this is a
 * small, bounded loop, not a performance concern.
 */
function resolveDependencyGraph(
  selected: ReadonlyMap<string, SchemaModule>,
  issues: RegistryIssue[],
): { valid: Map<string, SchemaModule>; order: string[] } {
  const current = new Map(selected);
  let stable = false;

  while (!stable) {
    stable = true;

    for (const [id, module] of [...current]) {
      const hasMissingDependency = (module.manifest.dependsOn ?? []).some(
        (dep) => !current.has(dep),
      );
      if (hasMissingDependency) {
        current.delete(id);
        issues.push({ code: 'REGISTRY_MISSING_DEPENDENCY', moduleId: id });
        stable = false;
      }
    }

    for (const cycle of detectCycles(current)) {
      for (const id of cycle) {
        if (current.delete(id)) {
          issues.push({ code: 'REGISTRY_DEPENDENCY_CYCLE', moduleId: id });
        }
      }
      stable = false;
    }
  }

  return { valid: current, order: topoSort(current) };
}

/** DFS with an explicit path stack; a back-edge to a node still on the stack closes a cycle (same technique `@mcs/graph`'s cycle detector uses, reimplemented locally rather than adding a cross-package dependency for a handful of nodes). */
function detectCycles(modules: ReadonlyMap<string, SchemaModule>): string[][] {
  const cycles: string[][] = [];
  const finished = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();

  function visit(id: string): void {
    stack.push(id);
    onStack.add(id);

    for (const dep of modules.get(id)?.manifest.dependsOn ?? []) {
      if (!modules.has(dep)) continue; // reported separately as a missing dependency
      if (onStack.has(dep)) {
        const start = stack.indexOf(dep);
        cycles.push([...stack.slice(start), dep]);
        continue;
      }
      if (!finished.has(dep)) visit(dep);
    }

    stack.pop();
    onStack.delete(id);
    finished.add(id);
  }

  for (const id of modules.keys()) {
    if (!finished.has(id)) visit(id);
  }
  return cycles;
}

/** Post-order DFS: a module is only appended once every module it depends on already has been. Safe against infinite recursion because `resolveDependencyGraph` has already removed every cycle before this runs. */
function topoSort(modules: ReadonlyMap<string, SchemaModule>): string[] {
  const order: string[] = [];
  const visited = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    for (const dep of modules.get(id)?.manifest.dependsOn ?? []) {
      if (modules.has(dep)) visit(dep);
    }
    order.push(id);
  }

  for (const id of modules.keys()) visit(id);
  return order;
}

function pathsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((segment, index) => segment === b[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
