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
