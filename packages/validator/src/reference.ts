import { EntityRegistry, parseRuleLine, type Entity, type EntityKind } from '@mcs/config-model';
import { detectCycles } from '@mcs/graph';
import type { ConfigPath, MihomoYamlDocument } from '@mcs/yaml-engine';

import type { ValidationIssue } from './issue.js';
import type { ValidationStage } from './pipeline.js';

export const REFERENCE_STAGE_ID = 'reference';

/**
 * PRD §8.7 pipeline stage 4 (FR-VAL-03): duplicate names, missing
 * references, cycles, port conflicts. Consumes only what `@mcs/config-model`
 * and `@mcs/graph` already provide (`EntityRegistry.extract()`,
 * `detectCycles()`) — this file adds no new graph capability (E5, v0.4.0
 * plan). `@mcs/graph`'s own `ReferenceIndex` only records references that
 * *do* resolve (unresolved names are silently skipped by its `lookupName`),
 * so "is this name missing" is answered by a small, independent walk here
 * rather than by extending that index — extending it would violate E5.
 *
 * **Division of labour with `schemaStage` (v0.3.0 #12, v0.4.0 #2)**:
 * "条件缺项" (a branch missing its own required field, e.g. `type: http`
 * without `url`) is already reported by each module's `config.schema.json`
 * `required` array and `validation.rules.json` — that is a structural
 * violation of one entry's own shape, unrelated to whether some *other*
 * entity's name resolves. This stage never re-checks that, to avoid the
 * same problem surfacing as two different issues.
 *
 * All five checks are `severity: 'error'`, `blocking: true` — every one of
 * them is something the real Mihomo parser rejects or cannot bind, not a
 * style suggestion (contrast with `securityStage`, always `warning`).
 */
export const referenceStage: ValidationStage = {
  id: REFERENCE_STAGE_ID,
  run: (ctx) => {
    const { document } = ctx.parse;
    if (!document) return [];

    const entities = new EntityRegistry().extract(document);

    return [
      ...checkDuplicateNames(document, entities),
      ...checkMissingReferences(document, entities),
      ...checkCycles(document),
      ...checkPortConflicts(document),
    ];
  },
};

/**
 * Proxies, proxy-groups and built-in targets (`DIRECT`, `REJECT`, ...) share
 * one outbound-identifier namespace upstream — `config-model`'s own
 * `EntityRegistry` docs this (`UNCONDITIONAL_BUILTINS`'s comment: a proxy or
 * group reusing a built-in name is rejected upstream), which is why this
 * check groups all three kinds together rather than literally reading
 * "duplicate name" as "same `EntityKind`". `proxy-provider`/`rule-provider`
 * are map keys — YAML itself cannot represent a duplicate key, so
 * `EntityRegistry.extract()` never produces two entities to compare there.
 * `rule`/`sub-rule` entities use the entire rule *line* as their name
 * (`config-model/src/entity.ts`'s `extractStringArray`) — two byte-identical
 * lines are redundant, not a naming collision upstream would reject, so
 * those two kinds are deliberately excluded here.
 */
const SHARED_OUTBOUND_NAMESPACE: ReadonlySet<EntityKind> = new Set([
  'proxy',
  'proxy-group',
  'builtin',
]);

function checkDuplicateNames(
  document: MihomoYamlDocument,
  entities: readonly Entity[],
): ValidationIssue[] {
  const byName = new Map<string, Entity[]>();
  for (const entity of entities) {
    if (!SHARED_OUTBOUND_NAMESPACE.has(entity.kind)) continue;
    const group = byName.get(entity.serializedName);
    if (group) group.push(entity);
    else byName.set(entity.serializedName, [entity]);
  }

  const issues: ValidationIssue[] = [];
  for (const group of byName.values()) {
    // A name can appear once as a built-in (empty sourcePath) plus zero real
    // document entries with no conflict — only flag when more than one
    // *document* entity (non-empty sourcePath) shares the name, or a
    // document entity collides with a built-in.
    const userEntities = group.filter((entity) => entity.sourcePath.length > 0);
    if (userEntities.length === 0) continue;
    const isConflict = group.length > 1;
    if (!isConflict) continue;
    for (const entity of userEntities) {
      issues.push(referenceIssue(document, 'reference.duplicateName', entity.sourcePath));
    }
  }
  return issues;
}

/**
 * Mirrors `@mcs/graph`'s `reference-index.ts` `PROXY_TARGET_KINDS`/
 * `referenceKindsForField` grouping (not exported there, so duplicated here
 * in miniature — E5 forbids changing that file to export it). Keeping this
 * comment as the explicit pointer so the two never drift silently: any
 * change to which kinds a field may reference must update both files.
 */
const PROXY_TARGET_KINDS: readonly EntityKind[] = ['proxy', 'proxy-group', 'builtin'];

function checkMissingReferences(
  document: MihomoYamlDocument,
  entities: readonly Entity[],
): ValidationIssue[] {
  const names = buildNameIndex(entities);
  const issues: ValidationIssue[] = [];

  const groups = document.getIn(['proxy-groups']);
  if (Array.isArray(groups)) {
    groups.forEach((group, groupIndex) => {
      if (!isRecord(group)) return;
      checkSeqTargets(
        document,
        group.proxies,
        ['proxy-groups', groupIndex, 'proxies'],
        PROXY_TARGET_KINDS,
        names,
        issues,
      );
      checkSeqTargets(
        document,
        group.use,
        ['proxy-groups', groupIndex, 'use'],
        ['proxy-provider'],
        names,
        issues,
      );
    });
  }

  checkRuleLines(document, ['rules'], names, issues);

  const subRules = document.getIn(['sub-rules']);
  if (isRecord(subRules)) {
    for (const groupName of Object.keys(subRules)) {
      checkRuleLines(document, ['sub-rules', groupName], names, issues);
    }
  }

  return issues;
}

function checkSeqTargets(
  document: MihomoYamlDocument,
  items: unknown,
  basePath: ConfigPath,
  kinds: readonly EntityKind[],
  names: NameIndex,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(items)) return;
  items.forEach((item, index) => {
    if (typeof item !== 'string' || item === '') return;
    if (resolves(names, kinds, item)) return;
    issues.push(referenceIssue(document, 'reference.missingTarget', [...basePath, index]));
  });
}

function checkRuleLines(
  document: MihomoYamlDocument,
  basePath: ConfigPath,
  names: NameIndex,
  issues: ValidationIssue[],
): void {
  const rules = document.getIn(basePath);
  if (!Array.isArray(rules)) return;

  rules.forEach((line, index) => {
    if (typeof line !== 'string') return;
    const parsed = parseRuleLine(line);
    const path = [...basePath, index];

    if (parsed.type === 'RULE-SET' && parsed.payload) {
      if (!resolves(names, ['rule-provider'], parsed.payload.value)) {
        issues.push(referenceIssue(document, 'reference.missingRuleSet', path));
      }
    }

    // Every type's target names a proxy/proxy-group/builtin except
    // SUB-RULE, whose target names a sub-rule *group* (the map key under
    // `sub-rules:`) — not modelled as its own entity, the same documented
    // gap `reference-index.ts`'s `referenceKindsForField` takes, not
    // re-litigated here.
    if (parsed.type !== 'SUB-RULE' && parsed.target) {
      if (!resolves(names, PROXY_TARGET_KINDS, parsed.target.value)) {
        issues.push(referenceIssue(document, 'reference.missingRuleTarget', path));
      }
    }
  });
}

function checkCycles(document: MihomoYamlDocument): ValidationIssue[] {
  return detectCycles(document).map((cycle) => ({
    severity: 'error',
    code: 'reference.cycle',
    module: REFERENCE_STAGE_ID,
    messageKey: 'reference.cycle',
    messageParams: { cycle },
    blocking: true,
  }));
}

const PORT_FIELDS: readonly ConfigPath[] = [['port'], ['socks-port'], ['mixed-port']];

function checkPortConflicts(document: MihomoYamlDocument): ValidationIssue[] {
  const ports: Array<{ path: ConfigPath; value: number }> = [];

  for (const path of PORT_FIELDS) {
    const value = document.getIn(path);
    if (typeof value === 'number') ports.push({ path, value });
  }
  const controllerPort = extractHostPort(document.getIn(['external-controller']));
  if (controllerPort !== null) ports.push({ path: ['external-controller'], value: controllerPort });

  const issues: ValidationIssue[] = [];
  const reported = new Set<string>();
  for (let i = 0; i < ports.length; i += 1) {
    const left = ports[i];
    if (!left) continue;
    for (let j = i + 1; j < ports.length; j += 1) {
      const right = ports[j];
      if (!right || left.value !== right.value) continue;
      for (const entry of [left, right]) {
        const key = serializePath(entry.path);
        if (reported.has(key)) continue;
        reported.add(key);
        issues.push(referenceIssue(document, 'reference.portConflict', entry.path));
      }
    }
  }
  return issues;
}

/** `external-controller` is `host:port` (e.g. `127.0.0.1:9090`); only the port participates in the conflict check. */
function extractHostPort(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') return null;
  const separatorIndex = value.lastIndexOf(':');
  if (separatorIndex === -1) return null;
  const port = Number(value.slice(separatorIndex + 1));
  return Number.isInteger(port) ? port : null;
}

type NameIndex = ReadonlyMap<EntityKind, ReadonlySet<string>>;

function buildNameIndex(entities: readonly Entity[]): NameIndex {
  const index = new Map<EntityKind, Set<string>>();
  for (const entity of entities) {
    let byKind = index.get(entity.kind);
    if (!byKind) {
      byKind = new Set();
      index.set(entity.kind, byKind);
    }
    byKind.add(entity.serializedName);
  }
  return index;
}

function resolves(names: NameIndex, kinds: readonly EntityKind[], name: string): boolean {
  return kinds.some((kind) => names.get(kind)?.has(name) ?? false);
}

/** Path is the only identifying detail (NFR-SEC-03): never the resolved/unresolved name itself. */
function referenceIssue(
  document: MihomoYamlDocument,
  messageKey: string,
  path: ConfigPath,
): ValidationIssue {
  const range = document.locate(path) ?? undefined;
  return {
    severity: 'error',
    code: messageKey,
    module: REFERENCE_STAGE_ID,
    messageKey,
    path,
    ...(range !== undefined ? { range } : {}),
    blocking: true,
  };
}

function serializePath(path: ConfigPath): string {
  return JSON.stringify(path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
