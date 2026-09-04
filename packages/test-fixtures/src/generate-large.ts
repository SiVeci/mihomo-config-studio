/**
 * Deterministic generator for a large, realistic Mihomo-shaped YAML corpus —
 * used by `packages/validator`'s import benchmark (NFR-PERF-02). Not a
 * golden fixture: `fixtures/**` is byte-sensitive and a ~1 MB generated blob
 * doesn't belong there, and committing one would make every clone heavier
 * for no benefit. A fixed seed makes every call reproducible instead.
 */

export interface LargeCorpusOptions {
  /** Approximate output size in bytes; generation stops once this is reached. */
  readonly targetBytes?: number;
  readonly seed?: number;
}

const DEFAULT_TARGET_BYTES = 1024 * 1024;
const DEFAULT_SEED = 20260210;

/** mulberry32 — small, fast, and (unlike `Math.random()`) seedable, so runs are reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

const PROXY_TYPES = ['ss', 'vmess', 'trojan'] as const;
const CIPHERS = ['aes-256-gcm', 'chacha20-ietf-poly1305', 'aes-128-gcm'] as const;
const WORDS = ['news', 'video', 'social', 'shop', 'game', 'mail', 'cloud', 'cdn', 'api', 'static'];
const TLDS = ['com', 'net', 'org', 'io', 'dev'];

function randomDomain(rand: () => number): string {
  return `${pick(rand, WORDS)}${Math.floor(rand() * 1000)}.${pick(rand, TLDS)}`;
}

function randomUuid(rand: () => number): string {
  const hex = (): string => Math.floor(rand() * 16).toString(16);
  const group = (n: number): string => Array.from({ length: n }, hex).join('');
  return `${group(8)}-${group(4)}-${group(4)}-${group(4)}-${group(12)}`;
}

function proxyName(index: number): string {
  return `${PROXY_TYPES[index % PROXY_TYPES.length]}-node-${index}`;
}

/** One list item under `proxies:`, cycling through the three most common outbound types. */
function proxyEntry(rand: () => number, index: number): string {
  const type = PROXY_TYPES[index % PROXY_TYPES.length]!;
  const server = randomDomain(rand);
  const port = 10000 + Math.floor(rand() * 50000);
  const lines = [
    `  - name: "${proxyName(index)}"`,
    `    type: ${type}`,
    `    server: ${server}`,
    `    port: ${port}`,
  ];
  if (type === 'ss') {
    lines.push(
      `    cipher: ${pick(rand, CIPHERS)}`,
      `    password: "pw-${index}-${Math.floor(rand() * 1e6)}"`,
      '    udp: true',
    );
  } else if (type === 'vmess') {
    lines.push(
      `    uuid: ${randomUuid(rand)}`,
      '    alterId: 0',
      '    cipher: auto',
      '    tls: true',
    );
  } else {
    lines.push(
      `    password: "pw-${index}-${Math.floor(rand() * 1e6)}"`,
      `    sni: ${server}`,
      '    skip-cert-verify: false',
    );
  }
  // A periodic comment: real configs are not comment-free, and comments are
  // part of what the parser (and the CST round-trip layer) has to handle.
  if (index % 37 === 0) lines.push(`    # rotated node ${index}`);
  return lines.join('\n');
}

/**
 * `generateImportCorpus`'s own proxy-entry generator (v1.0.0 #3): the exact
 * same shape as `proxyEntry` above, minus that function's `udp: true` line
 * for the `ss` branch — `udp` is a real Mihomo field but not one the P0
 * `proxies` schema (`config.schema.json`'s `ss` def: `type`/`cipher`/
 * `password`/`plugin`/`plugin-opts` only) models, so every `ss` entry
 * `proxyEntry` produces is an *unintentional* unknown-field hit. That is the
 * right behaviour for `generateLargeCorpus`/`generateScaleCorpus` (perf
 * benchmarks, not success-rate corpora — `udp`'s realism there is a feature),
 * but it is exactly wrong here: at real 1 MB scale it multiplies into
 * thousands of unknown-field issues, each paying `MihomoYamlDocument#locate()`'s
 * per-issue `toText()` cost against the *whole* document (the same O(n²)
 * shape NFR-PERF-04 already names, `docs/releases/plans/v0.9.0-perf-baseline.md`)
 * — confirmed by measurement to turn a single corpus's `runPipeline()` call
 * from ~450ms into 130+ real seconds. `generateImportCorpus` adds exactly one
 * *deliberate* unknown field of its own (`unknown-field-probe`'s `smux`
 * block, singular) — this function keeps the rest of the corpus genuinely
 * P0-clean so that one deliberate probe is not drowned out by thousands of
 * accidental ones, and so the success-rate test actually finishes.
 */
function p0OnlyProxyEntry(rand: () => number, index: number): string {
  const type = PROXY_TYPES[index % PROXY_TYPES.length]!;
  const server = randomDomain(rand);
  const port = 10000 + Math.floor(rand() * 50000);
  const lines = [
    `  - name: "${proxyName(index)}"`,
    `    type: ${type}`,
    `    server: ${server}`,
    `    port: ${port}`,
  ];
  if (type === 'ss') {
    lines.push(
      `    cipher: ${pick(rand, CIPHERS)}`,
      `    password: "pw-${index}-${Math.floor(rand() * 1e6)}"`,
    );
  } else if (type === 'vmess') {
    lines.push(
      `    uuid: ${randomUuid(rand)}`,
      '    alterId: 0',
      '    cipher: auto',
      '    tls: true',
    );
  } else {
    lines.push(
      `    password: "pw-${index}-${Math.floor(rand() * 1e6)}"`,
      `    sni: ${server}`,
      '    skip-cert-verify: false',
    );
  }
  if (index % 37 === 0) lines.push(`    # rotated node ${index}`);
  return lines.join('\n');
}

const RULE_TYPES = ['DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'IP-CIDR', 'GEOIP'] as const;

function ruleLine(rand: () => number, index: number, targets: readonly string[]): string {
  const target = rand() < 0.85 ? pick(rand, targets) : 'DIRECT';
  switch (RULE_TYPES[index % RULE_TYPES.length]!) {
    case 'DOMAIN-SUFFIX':
      return `  - DOMAIN-SUFFIX,${randomDomain(rand)},${target}`;
    case 'DOMAIN-KEYWORD':
      return `  - DOMAIN-KEYWORD,${pick(rand, WORDS)}${index},${target}`;
    case 'IP-CIDR':
      return `  - IP-CIDR,10.${index % 256}.${Math.floor(rand() * 256)}.0/24,${target},no-resolve`;
    case 'GEOIP':
      return `  - GEOIP,${pick(rand, ['CN', 'US', 'JP', 'HK'])},${target}`;
  }
}

const HEADER = `mixed-port: 7890
allow-lan: true
bind-address: "*"
mode: rule
log-level: info
ipv6: true
external-controller: 127.0.0.1:9090

dns:
  enable: true
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  nameserver:
    - https://dns.alidns.com/dns-query
    - tls://dns.google:853
`;

/**
 * Generates a deterministic corpus shaped like a real, large Mihomo config
 * (proxies, proxy-groups, a long rules list, comments) rather than one line
 * repeated until it hits the target size — the latter would benchmark the
 * parser's best case, not a realistic one.
 */
export function generateLargeCorpus(options: LargeCorpusOptions = {}): string {
  const targetBytes = options.targetBytes ?? DEFAULT_TARGET_BYTES;
  const rand = mulberry32(options.seed ?? DEFAULT_SEED);

  const proxyLines: string[] = [];
  const proxyNames: string[] = [];
  let size = HEADER.length;
  // Proxies get roughly half the byte budget; the rules list (generated
  // next) absorbs the rest — real large configs skew heavily toward rules.
  const proxyBudget = targetBytes * 0.5;
  let index = 0;
  while (size < proxyBudget) {
    const entry = proxyEntry(rand, index);
    proxyLines.push(entry);
    proxyNames.push(proxyName(index));
    size += entry.length + 1;
    index += 1;
  }

  const groupProxyRefs = proxyNames.slice(0, 200).map((name) => `      - ${name}`);
  const groups = [
    ['  - name: PROXY', '    type: select', '    proxies:', ...groupProxyRefs].join('\n'),
    [
      '  - name: AUTO',
      '    type: url-test',
      '    tolerance: 50',
      '    url: "http://www.gstatic.com/generate_204"',
      '    interval: 300',
      '    proxies:',
      ...groupProxyRefs,
    ].join('\n'),
    [
      '  - name: FALLBACK',
      '    type: fallback',
      '    url: "http://www.gstatic.com/generate_204"',
      '    interval: 300',
      '    proxies: [DIRECT, REJECT]',
    ].join('\n'),
  ];
  size += groups.reduce((total, group) => total + group.length + 1, 0);

  const ruleTargets = ['PROXY', 'AUTO', 'FALLBACK', ...proxyNames.slice(0, 50)];
  const ruleLines: string[] = [];
  let ruleIndex = 0;
  while (size < targetBytes) {
    const line = ruleLine(rand, ruleIndex, ruleTargets);
    ruleLines.push(line);
    size += line.length + 1;
    ruleIndex += 1;
  }
  ruleLines.push('  - MATCH,PROXY');

  return [
    HEADER,
    'proxies:',
    proxyLines.join('\n'),
    '',
    'proxy-groups:',
    groups.join('\n'),
    '',
    'rules:',
    ruleLines.join('\n'),
    '',
  ].join('\n');
}

export interface ImportCorpusOptions {
  /** Approximate output size in bytes; generation stops once this is reached. */
  readonly targetBytes?: number;
  readonly seed?: number;
}

/**
 * Deterministic ~1 MB corpus covering all ten built-in P0 modules
 * (ADR-037), for the "1 MB import success rate" metric (§14.1 indicator 5,
 * v1.0.0 #3) — `generateLargeCorpus` only ever exercises three
 * (`proxies`/`proxy-groups`/`rules`), too narrow a shape for a claim about
 * "legal test corpora" in general. Built by extending the same
 * `proxies`/`proxy-groups`/`rules` backbone (reusing this file's own
 * private helpers, not duplicating them) with the six modules it omits,
 * plus the three YAML features a real large config exercises that a
 * proxies/rules-only corpus never touches: a deliberately unmodeled field
 * (an `unknown-fields` case, same field `schema-builtin`'s own
 * `proxies/examples/unknown-fields.yaml` uses), an anchor, and a merge key
 * (`<<:`) — mirroring `packages/test-fixtures/fixtures/yaml/comprehensive.yaml`'s
 * own `health-check: {enable: true, <<: *common-hc}` pattern, the one this
 * repo already trusts to round-trip correctly.
 *
 * Deliberately **not** exported as "generate a set" — the corpus *set*
 * ADR-037 defines is simply N calls to this function with N distinct seeds,
 * left to the caller (`import-success-rate.test.ts`) rather than baked in
 * here, so the sample count is a test-level policy decision, not a
 * generator-level one.
 */
export function generateImportCorpus(options: ImportCorpusOptions = {}): string {
  const targetBytes = options.targetBytes ?? DEFAULT_TARGET_BYTES;
  const rand = mulberry32(options.seed ?? DEFAULT_SEED);

  const proxyLines: string[] = [];
  const proxyNames: string[] = [];
  let size = HEADER.length;
  const proxyBudget = targetBytes * 0.5;
  let index = 0;
  while (size < proxyBudget) {
    const entry = p0OnlyProxyEntry(rand, index);
    proxyLines.push(entry);
    proxyNames.push(proxyName(index));
    size += entry.length + 1;
    index += 1;
  }

  // A fixed (non-random), single unknown-field probe — same field
  // `schema-builtin`'s own `proxies/examples/unknown-fields.yaml` uses
  // (`smux`, a real, documented Mihomo field this project's P0 schema
  // deliberately excludes), so "import succeeded" here means the same thing
  // it means everywhere else in this repo: parsed with no syntax issues and
  // no *blocking* validation issue — an unknown field is a real, expected,
  // non-blocking part of that answer, not something that should vanish from
  // the corpus for convenience.
  const unknownFieldProbe = [
    '  - name: "unknown-field-probe"',
    '    type: ss',
    '    server: probe.example.com',
    '    port: 8388',
    '    cipher: aes-128-gcm',
    '    password: "probe-password"',
    '    smux:',
    '      enabled: false',
    '      protocol: smux',
  ].join('\n');
  proxyLines.push(unknownFieldProbe);
  proxyNames.push('unknown-field-probe');

  const groupProxyRefs = proxyNames.slice(0, 200).map((name) => `      - ${name}`);
  const groups = [
    ['  - name: PROXY', '    type: select', '    proxies:', ...groupProxyRefs].join('\n'),
    [
      '  - name: AUTO',
      '    type: url-test',
      '    tolerance: 50',
      '    url: "http://www.gstatic.com/generate_204"',
      '    interval: 300',
      '    proxies:',
      ...groupProxyRefs,
    ].join('\n'),
    [
      '  - name: FALLBACK',
      '    type: fallback',
      '    url: "http://www.gstatic.com/generate_204"',
      '    interval: 300',
      '    proxies: [DIRECT, REJECT]',
    ].join('\n'),
  ];
  size += groups.reduce((total, group) => total + group.length + 1, 0);

  const ruleTargets = ['PROXY', 'AUTO', 'FALLBACK', ...proxyNames.slice(0, 50)];
  const ruleLines: string[] = [];
  let ruleIndex = 0;
  while (size < targetBytes) {
    const line = ruleLine(rand, ruleIndex, ruleTargets);
    ruleLines.push(line);
    size += line.length + 1;
    ruleIndex += 1;
  }
  ruleLines.push('  - MATCH,PROXY');

  // `sniffer` (root: ['sniffer']) — `schema-builtin/modules/sniffer/examples/valid.yaml`'s shape.
  const sniffer = [
    'sniffer:',
    '  enable: true',
    '  override-destination: false',
    '  sniff:',
    '    HTTP:',
    '      ports:',
    '        - 80',
    '        - "8080-8880"',
    '    TLS: {}',
    '    QUIC: {}',
  ].join('\n');

  // `inbound` (root: [], top-level keys) — `schema-builtin/modules/inbound/examples/valid.yaml`'s `tun` block (`mixed-port` is already in `HEADER`).
  const inbound = [
    'tun:',
    '  enable: false',
    '  stack: system',
    '  dns-hijack:',
    '    - 0.0.0.0:53',
    '  auto-redirect: false',
  ].join('\n');

  // `proxy-providers` (map) — an anchor (`&common-provider`) merged into a
  // second entry via `<<:`, the anchor/merge-key coverage ADR-037 calls for.
  const proxyProviders = [
    'proxy-providers:',
    '  provider1: &common-provider',
    '    type: http',
    '    url: "https://example.com/subscribe?token=probe-1"',
    '    interval: 3600',
    '    path: ./provider1.yaml',
    '    health-check:',
    '      enable: true',
    '      interval: 600',
    '      url: https://cp.cloudflare.com/generate_204',
    '  provider2:',
    '    <<: *common-provider',
    '    path: ./provider2.yaml',
  ].join('\n');

  // `rule-providers` (map).
  const ruleProviders = [
    'rule-providers:',
    '  cn-domain:',
    '    type: http',
    '    behavior: domain',
    '    format: yaml',
    '    url: "https://example.com/rules/cn-domain.yaml"',
    '    interval: 259200',
    '    path: ./rule-providers/cn-domain.yaml',
  ].join('\n');

  // `sub-rules` (map of rule-line lists).
  const subRules = [
    'sub-rules:',
    '  sub-rule-probe:',
    `    - DOMAIN,${randomDomain(rand)},PROXY`,
    '    - MATCH,DIRECT',
  ].join('\n');

  return [
    HEADER,
    sniffer,
    '',
    inbound,
    '',
    'proxies:',
    proxyLines.join('\n'),
    '',
    'proxy-groups:',
    groups.join('\n'),
    '',
    proxyProviders,
    '',
    ruleProviders,
    '',
    subRules,
    '',
    'rules:',
    ruleLines.join('\n'),
    '',
  ].join('\n');
}

export interface ScaleCorpusOptions {
  /** Total `proxy` + `proxy-group` entities. Rules are counted separately (`ruleCount`) — real configs grow the two axes independently, unlike `generateLargeCorpus`'s single byte budget. */
  readonly entityCount?: number;
  readonly ruleCount?: number;
  readonly seed?: number;
}

const DEFAULT_ENTITY_COUNT = 1000;
const DEFAULT_RULE_COUNT = 10_000;
/** Roughly matches a real config's proxy-to-group ratio — groups are the minority. */
const GROUP_SHARE = 0.2;

/**
 * Deterministic corpus sized by *count* along two independent axes (entities,
 * rules) rather than by total byte size — NFR-PERF-04 asks for exactly
 * "1,000 entities + 10,000 rules", a shape `generateLargeCorpus` cannot
 * target since its proxy and rule sections both grow toward one shared byte
 * budget (v0.4.0 #14). Every rule targets a real, generated proxy-group (or
 * `DIRECT`) — this is a structurally clean corpus (no missing references, no
 * cycles) so the benchmark it feeds measures normal-case cost, not the
 * error-reporting paths `reference.test.ts` already covers.
 */
export function generateScaleCorpus(options: ScaleCorpusOptions = {}): string {
  const entityCount = options.entityCount ?? DEFAULT_ENTITY_COUNT;
  const ruleCount = options.ruleCount ?? DEFAULT_RULE_COUNT;
  const rand = mulberry32(options.seed ?? DEFAULT_SEED);

  const groupCount = Math.max(1, Math.round(entityCount * GROUP_SHARE));
  const proxyCount = Math.max(1, entityCount - groupCount);

  const proxyLines: string[] = [];
  const proxyNames: string[] = [];
  for (let index = 0; index < proxyCount; index += 1) {
    proxyLines.push(proxyEntry(rand, index));
    proxyNames.push(proxyName(index));
  }

  // `proxiesPerGroup >= 1` and `proxyCount >= groupCount * 1` never both hold
  // for every input, but `start = index * proxiesPerGroup` stays below
  // `proxyNames.length` for every valid `index < groupCount` regardless —
  // each group's slice is never empty, so there is no empty-`proxies:`
  // fallback branch to reach.
  const proxiesPerGroup = Math.max(1, Math.floor(proxyNames.length / groupCount));
  const groupNames: string[] = [];
  const groupLines: string[] = [];
  for (let index = 0; index < groupCount; index += 1) {
    const name = `scale-group-${index}`;
    groupNames.push(name);
    const start = index * proxiesPerGroup;
    const refs = proxyNames
      .slice(start, start + proxiesPerGroup)
      .map((member) => `      - ${member}`);
    groupLines.push([`  - name: ${name}`, '    type: select', '    proxies:', ...refs].join('\n'));
  }

  const ruleTargets = [...groupNames, 'DIRECT'];
  const ruleLines: string[] = [];
  for (let index = 0; index < Math.max(0, ruleCount - 1); index += 1) {
    ruleLines.push(ruleLine(rand, index, ruleTargets));
  }
  ruleLines.push('  - MATCH,DIRECT');

  return [
    HEADER,
    'proxies:',
    proxyLines.join('\n'),
    '',
    'proxy-groups:',
    groupLines.join('\n'),
    '',
    'rules:',
    ruleLines.join('\n'),
    '',
  ].join('\n');
}
