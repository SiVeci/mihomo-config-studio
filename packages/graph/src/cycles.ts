import type { MihomoYamlDocument } from '@mcs/yaml-engine';

/** A cycle as the sequence of entity names that form it, first and last equal. */
export type Cycle = readonly string[];

/**
 * Detects cycles across the two edge kinds mihomo would loop on forever:
 * proxy-groups nesting each other via `proxies[]`, and individual proxies
 * chaining through `dialer-proxy`. Returns the cyclic path itself for each
 * finding, not a boolean — entity names only, never configuration values
 * (NFR-SEC-03).
 */
export function detectCycles(document: MihomoYamlDocument): Cycle[] {
  const graph = new Map<string, string[]>();
  addGroupNestingEdges(document, graph);
  addDialerProxyEdges(document, graph);
  return findCycles(graph);
}

function addGroupNestingEdges(document: MihomoYamlDocument, graph: Map<string, string[]>): void {
  const groups = document.getIn(['proxy-groups']);
  if (!Array.isArray(groups)) return;

  const groupNames = new Set(
    groups
      .filter(isRecord)
      .map((group) => group.name)
      .filter(isString),
  );
  for (const group of groups) {
    if (!isRecord(group) || !isString(group.name)) continue;
    if (!Array.isArray(group.proxies)) continue;
    for (const item of group.proxies) {
      if (isString(item) && groupNames.has(item)) {
        addEdge(graph, group.name, item);
      }
    }
  }
}

function addDialerProxyEdges(document: MihomoYamlDocument, graph: Map<string, string[]>): void {
  const proxies = document.getIn(['proxies']);
  if (!Array.isArray(proxies)) return;

  const proxyNames = new Set(
    proxies
      .filter(isRecord)
      .map((proxy) => proxy.name)
      .filter(isString),
  );
  for (const proxy of proxies) {
    if (!isRecord(proxy) || !isString(proxy.name)) continue;
    const dialerProxy = proxy['dialer-proxy'];
    if (isString(dialerProxy) && proxyNames.has(dialerProxy)) {
      addEdge(graph, proxy.name, dialerProxy);
    }
  }
}

function addEdge(graph: Map<string, string[]>, from: string, to: string): void {
  const existing = graph.get(from);
  if (existing) existing.push(to);
  else graph.set(from, [to]);
}

/** DFS with an explicit path stack; a back-edge to a node still on the stack closes a cycle. */
function findCycles(graph: Map<string, string[]>): Cycle[] {
  const cycles: Cycle[] = [];
  const finished = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();

  function visit(node: string): void {
    stack.push(node);
    onStack.add(node);

    for (const next of graph.get(node) ?? []) {
      if (onStack.has(next)) {
        const start = stack.indexOf(next);
        cycles.push([...stack.slice(start), next]);
        continue;
      }
      if (!finished.has(next)) visit(next);
    }

    stack.pop();
    onStack.delete(node);
    finished.add(node);
  }

  for (const node of graph.keys()) {
    if (!finished.has(node)) visit(node);
  }

  return cycles;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
