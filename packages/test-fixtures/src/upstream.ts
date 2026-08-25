/**
 * Frozen facts about the vendored Mihomo v1.19.29 sample
 * (`fixtures/upstream/mihomo-v1.19.29/config.yaml`, see its `SOURCE.md`).
 *
 * This file is data, not a parser: every path below was read out of the
 * vendored file by hand, one section at a time, and is meant to be a
 * regression fence — v0.3.0 #6–#11 assert their own module Schemas against
 * `UPSTREAM_P0_FIELDS` in both directions (Schema declares a field upstream
 * doesn't have → red; upstream has a P0 field Schema doesn't declare → red).
 * Nothing here reads the fixture file itself — `upstream.test.ts` does that.
 */

/** Provenance, mirrored from `fixtures/upstream/mihomo-v1.19.29/SOURCE.md`. */
export const UPSTREAM_SOURCE = {
  repo: 'MetaCubeX/mihomo',
  tag: 'v1.19.29',
  commit: 'e26714a181ac0e2fa803453c0a8e9a9ce94e31cb',
  filePath: 'docs/config.yaml',
  vendoredPath: 'upstream/mihomo-v1.19.29/config.yaml',
  gitBlobSha1: '0598d098e117c6ec3126beaacebc18108a292e45',
  byteLength: 134840,
  sha256: '47e5b8331499020cfcce75041e3612bcd7c4b94dced9d713c0107b0f70f90dbe',
  retrievedOn: '2026-08-19',
} as const;

/**
 * The ten P0 modules this version covers (PRD §8.3, "配置模块覆盖" table).
 * v0.3.0 shipped the first six; v0.4.0 #0 adds the back half: `proxy-groups`,
 * `rule-providers`, `rules`, `sub-rules`.
 */
export const P0_MODULE_IDS = [
  'general',
  'dns',
  'sniffer',
  'inbound',
  'proxies',
  'proxy-providers',
  'proxy-groups',
  'rule-providers',
  'rules',
  'sub-rules',
] as const;
export type P0ModuleId = (typeof P0_MODULE_IDS)[number];

/** The nine P0 outbound protocols (PRD §8.3, "出站节点" row). */
export const P0_PROTOCOLS = [
  'http',
  'socks5',
  'ss',
  'vmess',
  'vless',
  'trojan',
  'hysteria2',
  'tuic',
  'wireguard',
] as const;
export type P0Protocol = (typeof P0_PROTOCOLS)[number];

export interface UpstreamFieldRecord {
  /**
   * For `general`/`dns`/`sniffer`/`inbound`: a dot path into the document
   * (e.g. `profile.store-selected`), or a bare top-level key. For
   * `proxies`/`proxy-providers`/`proxy-groups`/`rule-providers`:
   * `_shared.<field>` for a field common to every branch of that module's
   * discriminated union, `<branch>.<field>` for a branch-specific field, or
   * a bare `<type>` naming a whole branch this version deliberately does not
   * cover (see `note`). For `rules`: a bare upper-case rule-type token (e.g.
   * `DOMAIN-SUFFIX`) — these are comma-separated list values, not YAML keys,
   * so the traceability check below matches `<TYPE>,` rather than
   * `<key>:` for this module (see `upstream.test.ts`). For `sub-rules`: this
   * module has no field vocabulary of its own (its list items are rule
   * lines using the exact same DSL as `rules`), so its record set only
   * documents its distinct *shape*, not a duplicate type catalog.
   */
  path: string;
  /** False only when PRD claims P0 coverage this vendored sample does not demonstrate — see the record's `note`. */
  presentUpstream: boolean;
  note?: string;
}

const P1P2_PROTOCOL_NOTE =
  'P1/P2: whole protocol present upstream, deliberately not in P0 scope (PRD §8.3) — walks the unknown-field tree, not the Schema';

/**
 * general (PRD §8.3 P0: mode、log-level、IPv6、LAN、controller、profile、
 * GEO、连接选项). Structural note for #6: these fields are scattered at the
 * *document root* (no wrapping `general:` key upstream) — the same root
 * `inbound`'s port fields and `tun:` live at (see `inbound` below). Two
 * modules sharing the document root means `buildFormPlan`'s per-module
 * "unknown fields" pass will, once both exist (#8), see each other's
 * territory as unrecognized — deliberately left unresolved until #14, which
 * is where a real multi-module document is actually rendered and the right
 * shape for the fix (a `buildFormPlan` option? something else?) becomes
 * decidable instead of guessed at.
 *
 * `hosts` also lives here (v0.3.0 #7), despite PRD's §8.3 table grouping it
 * under DNS conceptually: it is a document-root key (line 119 of the
 * vendored sample), not nested under `dns:`, so only a module whose own
 * `manifest.root` is `[]` can reach it. `general` already is that module
 * (see above); `dns` is not (its root is `['dns']`, matching where all its
 * *other* fields genuinely live) — giving `dns` a second, document-root
 * scope just to reach one field would recreate the exact sharing problem
 * this note already flags, for no benefit. Structural ownership follows
 * where a field actually lives in the document, not PRD's topic grouping.
 */
const GENERAL_FIELDS: UpstreamFieldRecord[] = [
  { path: 'mode', presentUpstream: true },
  { path: 'log-level', presentUpstream: true },
  { path: 'ipv6', presentUpstream: true },
  // LAN
  { path: 'allow-lan', presentUpstream: true },
  { path: 'bind-address', presentUpstream: true },
  { path: 'authentication', presentUpstream: true },
  { path: 'skip-auth-prefixes', presentUpstream: true },
  { path: 'lan-allowed-ips', presentUpstream: true },
  { path: 'lan-disallowed-ips', presentUpstream: true },
  // controller
  { path: 'external-controller', presentUpstream: true },
  { path: 'external-controller-tls', presentUpstream: true },
  {
    path: 'secret',
    presentUpstream: true,
    note: 'commented out in the sample (`# secret: "123456"`) but the core Controller auth field; NFR-SEC-02 requires it map to the `secret` control',
  },
  // profile
  { path: 'profile', presentUpstream: true },
  { path: 'profile.store-selected', presentUpstream: true },
  { path: 'profile.store-fake-ip', presentUpstream: true },
  // GEO
  { path: 'geox-url', presentUpstream: true },
  { path: 'geox-url.geoip', presentUpstream: true },
  { path: 'geox-url.geosite', presentUpstream: true },
  { path: 'geox-url.mmdb', presentUpstream: true },
  { path: 'geo-auto-update', presentUpstream: true },
  { path: 'geo-update-interval', presentUpstream: true },
  // connection options
  { path: 'find-process-mode', presentUpstream: true },
  {
    path: 'tcp-concurrent',
    presentUpstream: true,
    note: 'commented out in the sample but a documented connection option',
  },
  {
    path: 'hosts',
    presentUpstream: true,
    note: 'document-root key; PRD groups it under DNS conceptually but only a document-root module can reach it — see the module note above',
  },
];

/**
 * dns (PRD §8.3 P0: enable、listen、enhanced-mode、fake-ip、nameserver、
 * fallback、policy、hosts; v0.3.0 #7 implementation notes add
 * "fallback（含 fallback-filter）" explicitly). `hosts` moved to `general`
 * (see its module note) — it is a document-root key `dns`'s own root
 * (`['dns']`) cannot reach, not nested under `dns:` despite PRD grouping it
 * with DNS conceptually. `fallback-filter.geosite` is upstream-documented
 * as deprecated in favour of `nameserver-policy` (line 352 of the vendored
 * sample) and is deliberately excluded — a deprecated field is not "P0
 * commonly used", and reviving it here would point users at a path
 * upstream itself says not to use.
 */
const DNS_FIELDS: UpstreamFieldRecord[] = [
  { path: 'dns.enable', presentUpstream: true },
  { path: 'dns.listen', presentUpstream: true },
  { path: 'dns.enhanced-mode', presentUpstream: true },
  { path: 'dns.fake-ip-range', presentUpstream: true },
  { path: 'dns.fake-ip-filter', presentUpstream: true },
  { path: 'dns.nameserver', presentUpstream: true },
  {
    path: 'dns.fallback',
    presentUpstream: true,
    note: 'commented out in the sample (only demonstrated as a comment block) but a core, documented field',
  },
  {
    path: 'dns.fallback-filter',
    presentUpstream: true,
    note: 'commented out in the sample; gates which fallback-filter sub-fields apply',
  },
  {
    path: 'dns.fallback-filter.geoip',
    presentUpstream: true,
    note: 'commented out in the sample',
  },
  {
    path: 'dns.fallback-filter.geoip-code',
    presentUpstream: true,
    note: 'commented out in the sample',
  },
  {
    path: 'dns.fallback-filter.ipcidr',
    presentUpstream: true,
    note: 'commented out in the sample',
  },
  {
    path: 'dns.fallback-filter.domain',
    presentUpstream: true,
    note: 'commented out in the sample',
  },
  { path: 'dns.nameserver-policy', presentUpstream: true },
];

/**
 * sniffer (PRD §8.3 P0: 常用嗅探开关与协议). PRD explicitly puts
 * "高级 force/skip 条件" in P1/P2, so `force-domain`/`skip-domain` and the
 * deprecated `sniffing`/`port-whitelist` lists are excluded here on purpose.
 */
const SNIFFER_FIELDS: UpstreamFieldRecord[] = [
  { path: 'sniffer.enable', presentUpstream: true },
  { path: 'sniffer.sniff', presentUpstream: true },
  { path: 'sniffer.sniff.HTTP', presentUpstream: true },
  { path: 'sniffer.sniff.HTTP.ports', presentUpstream: true },
  { path: 'sniffer.sniff.TLS', presentUpstream: true },
  { path: 'sniffer.sniff.QUIC', presentUpstream: true },
  { path: 'sniffer.override-destination', presentUpstream: true },
];

/**
 * inbound (PRD §8.3 P0: HTTP/SOCKS/Mixed 端口、常用 TUN). Structural note:
 * the individual ports and `tun:` are document-root keys, same root
 * `general`'s fields live at (see note there). `listeners:` (multi-instance
 * inbound declarations) is explicitly P1/P2 per PRD ("全部 Listeners 和
 * 服务端协议") and is out of scope entirely, not just trimmed.
 */
const INBOUND_FIELDS: UpstreamFieldRecord[] = [
  {
    path: 'port',
    presentUpstream: true,
    note: 'commented out in the sample (`# port: 7890`) but the HTTP inbound port',
  },
  {
    path: 'socks-port',
    presentUpstream: true,
    note: 'commented out in the sample (`# socks-port: 7891`) but the SOCKS inbound port',
  },
  { path: 'mixed-port', presentUpstream: true },
  { path: 'tun', presentUpstream: true },
  { path: 'tun.enable', presentUpstream: true },
  { path: 'tun.stack', presentUpstream: true },
  { path: 'tun.dns-hijack', presentUpstream: true },
  { path: 'tun.auto-redirect', presentUpstream: true },
];

/**
 * proxies (PRD §8.3 P0: HTTP、SOCKS、SS、VMess、VLESS、Trojan、Hysteria2、
 * TUIC、WireGuard). `_shared.*` fields are demonstrated identically across
 * every P0 protocol's example block. Field grain stops at the
 * commonly-toggled, uncommented-or-clearly-core level in the sample —
 * exotic nested knobs (kcptun tuning, xhttp padding/reuse settings,
 * tlsmirror-opts, reality-opts beyond public-key/short-id, ...) are P1/P2
 * and reach the user through the unknown-field tree, not this inventory.
 */
const PROXIES_FIELDS: UpstreamFieldRecord[] = [
  { path: '_shared.name', presentUpstream: true },
  { path: '_shared.type', presentUpstream: true, note: 'the discriminator key' },
  { path: '_shared.server', presentUpstream: true },
  { path: '_shared.port', presentUpstream: true },
  { path: '_shared.udp', presentUpstream: true },

  // HTTP
  { path: 'http.username', presentUpstream: true },
  { path: 'http.password', presentUpstream: true },
  { path: 'http.tls', presentUpstream: true },
  { path: 'http.sni', presentUpstream: true },
  { path: 'http.skip-cert-verify', presentUpstream: true },

  // SOCKS (type: socks5)
  { path: 'socks5.username', presentUpstream: true },
  { path: 'socks5.password', presentUpstream: true },
  { path: 'socks5.tls', presentUpstream: true },
  { path: 'socks5.skip-cert-verify', presentUpstream: true },

  // Shadowsocks (type: ss)
  { path: 'ss.cipher', presentUpstream: true },
  {
    path: 'ss.password',
    presentUpstream: true,
    note: 'NFR-SEC-02: must map to the `secret` control',
  },
  { path: 'ss.plugin', presentUpstream: true },
  { path: 'ss.plugin-opts', presentUpstream: true },

  // VMess
  {
    path: 'vmess.uuid',
    presentUpstream: true,
    note: 'NFR-SEC-02: must map to the `secret` control',
  },
  { path: 'vmess.alterId', presentUpstream: true },
  { path: 'vmess.cipher', presentUpstream: true },
  { path: 'vmess.tls', presentUpstream: true },
  { path: 'vmess.network', presentUpstream: true },
  { path: 'vmess.servername', presentUpstream: true },
  { path: 'vmess.skip-cert-verify', presentUpstream: true },
  { path: 'vmess.ws-opts', presentUpstream: true },
  { path: 'vmess.h2-opts', presentUpstream: true },
  { path: 'vmess.grpc-opts', presentUpstream: true },

  // VLESS
  {
    path: 'vless.uuid',
    presentUpstream: true,
    note: 'NFR-SEC-02: must map to the `secret` control',
  },
  { path: 'vless.network', presentUpstream: true },
  { path: 'vless.tls', presentUpstream: true },
  { path: 'vless.flow', presentUpstream: true },
  { path: 'vless.servername', presentUpstream: true },
  { path: 'vless.client-fingerprint', presentUpstream: true },
  { path: 'vless.skip-cert-verify', presentUpstream: true },
  { path: 'vless.reality-opts', presentUpstream: true },
  { path: 'vless.reality-opts.public-key', presentUpstream: true },
  { path: 'vless.reality-opts.short-id', presentUpstream: true },
  { path: 'vless.ws-opts', presentUpstream: true },
  { path: 'vless.grpc-opts', presentUpstream: true },

  // Trojan
  {
    path: 'trojan.password',
    presentUpstream: true,
    note: 'NFR-SEC-02: must map to the `secret` control',
  },
  { path: 'trojan.sni', presentUpstream: true },
  { path: 'trojan.skip-cert-verify', presentUpstream: true },
  { path: 'trojan.network', presentUpstream: true },
  { path: 'trojan.ws-opts', presentUpstream: true },
  { path: 'trojan.grpc-opts', presentUpstream: true },

  // Hysteria2
  {
    path: 'hysteria2.password',
    presentUpstream: true,
    note: 'NFR-SEC-02: must map to the `secret` control',
  },
  { path: 'hysteria2.up', presentUpstream: true },
  { path: 'hysteria2.down', presentUpstream: true },
  { path: 'hysteria2.obfs', presentUpstream: true },
  { path: 'hysteria2.obfs-password', presentUpstream: true },
  { path: 'hysteria2.sni', presentUpstream: true },
  { path: 'hysteria2.skip-cert-verify', presentUpstream: true },
  { path: 'hysteria2.alpn', presentUpstream: true },

  // TUIC
  {
    path: 'tuic.uuid',
    presentUpstream: true,
    note: 'NFR-SEC-02: must map to the `secret` control',
  },
  {
    path: 'tuic.password',
    presentUpstream: true,
    note: 'NFR-SEC-02: must map to the `secret` control',
  },
  {
    path: 'tuic.token',
    presentUpstream: true,
    note: 'tuicV4 legacy auth, mutually exclusive with uuid+password',
  },
  { path: 'tuic.alpn', presentUpstream: true },
  { path: 'tuic.udp-relay-mode', presentUpstream: true },
  { path: 'tuic.disable-sni', presentUpstream: true },
  { path: 'tuic.reduce-rtt', presentUpstream: true },
  { path: 'tuic.request-timeout', presentUpstream: true },

  // WireGuard
  { path: 'wireguard.ip', presentUpstream: true },
  { path: 'wireguard.ipv6', presentUpstream: true },
  { path: 'wireguard.public-key', presentUpstream: true },
  {
    path: 'wireguard.private-key',
    presentUpstream: true,
    note: 'multi-line key material; NFR-SEC-02 must map to the `secret` control (golden multi-line-secret fixture, see #19)',
  },
  { path: 'wireguard.reserved', presentUpstream: true },

  // P1/P2 protocols this version deliberately does not cover (PRD §8.3 P1/P2 row + "等")
  { path: 'snell', presentUpstream: true, note: P1P2_PROTOCOL_NOTE },
  { path: 'gost-relay', presentUpstream: true, note: P1P2_PROTOCOL_NOTE },
  {
    path: 'hysteria',
    presentUpstream: true,
    note: `${P1P2_PROTOCOL_NOTE} (Hysteria v1, distinct from P0 hysteria2)`,
  },
  { path: 'tailscale', presentUpstream: true, note: P1P2_PROTOCOL_NOTE },
  { path: 'openvpn', presentUpstream: true, note: P1P2_PROTOCOL_NOTE },
  { path: 'masque', presentUpstream: true, note: P1P2_PROTOCOL_NOTE },
  { path: 'shadowquic', presentUpstream: true, note: P1P2_PROTOCOL_NOTE },
  { path: 'ssr', presentUpstream: true, note: P1P2_PROTOCOL_NOTE },
  { path: 'ssh', presentUpstream: true, note: P1P2_PROTOCOL_NOTE },
  { path: 'mieru', presentUpstream: true, note: P1P2_PROTOCOL_NOTE },
  { path: 'sudoku', presentUpstream: true, note: P1P2_PROTOCOL_NOTE },
  { path: 'anytls', presentUpstream: true, note: P1P2_PROTOCOL_NOTE },
  { path: 'trusttunnel', presentUpstream: true, note: P1P2_PROTOCOL_NOTE },
];

/**
 * proxy-providers (PRD §8.3 P0: HTTP/File/Inline、健康检查、过滤、覆写).
 * Same discriminated-union shape as `proxies` (v0.3.0 #9's `_shared.<key>` /
 * `<branch>.<key>` naming) — `type` picks http/file/inline, each with its
 * own required field; `health-check`/`override`/`filter`/`exclude-filter`
 * apply uniformly regardless of source, so they live under `_shared`.
 *
 * `filter`/`exclude-filter` were `presentUpstream: false` as of #3 — the
 * vendored sample only demonstrates `filter` on a proxy-*group*'s `use:`
 * (line 1711: `filter: "HK|TW"`), never directly on a `proxy-providers`
 * entry. D-004 flagged this for separate verification before #11 built the
 * module. That verification (v0.3.0 #11, 2026-08-20) is done: the official
 * Meta-Docs source (github.com/MetaCubeX/Meta-Docs,
 * docs/config/proxy-providers/index.md) documents `filter`, `exclude-filter`,
 * and `exclude-type` as top-level `proxy-providers` fields, with a worked
 * example (`filter: "(?i)港|hk|hongkong|hong kong"`). D-004 is closed with
 * this result; see `docs/upstream-divergences.md`. `exclude-type` is real
 * but outside this version's explicit P0 field range (plan #11 "实现要点"
 * never names it) — reachable via the unknown-field tree, not modelled.
 */
const PROXY_PROVIDERS_FIELDS: UpstreamFieldRecord[] = [
  { path: '_shared.type', presentUpstream: true, note: 'http | file | inline' },
  {
    path: 'http.url',
    presentUpstream: true,
    note: 'NFR-SEC-02: subscription URL, must be `sensitive: true`',
  },
  { path: 'http.interval', presentUpstream: true },
  {
    path: 'http.path',
    presentUpstream: true,
    note: 'optional local cache location for the http type',
  },
  { path: 'http.proxy', presentUpstream: true, note: 'dialer used to fetch the provider itself' },
  { path: 'http.header', presentUpstream: true },
  { path: 'file.path', presentUpstream: true, note: 'required source file for the file type' },
  { path: 'inline.payload', presentUpstream: true, note: 'inline provider only (type: inline)' },
  { path: '_shared.health-check', presentUpstream: true },
  { path: '_shared.health-check.enable', presentUpstream: true },
  { path: '_shared.health-check.interval', presentUpstream: true },
  {
    path: '_shared.health-check.lazy',
    presentUpstream: true,
    note: 'commented out in the sample (`# lazy: true`) but a documented health-check option',
  },
  {
    path: '_shared.health-check.url',
    presentUpstream: true,
    note: 'probe URL, NOT sensitive — same-named `url` field on the http branch (the subscription address) is; see project-format ADR-018 heuristic-vs-Schema note',
  },
  { path: '_shared.override', presentUpstream: true },
  { path: '_shared.override.skip-cert-verify', presentUpstream: true },
  { path: '_shared.override.udp', presentUpstream: true },
  {
    path: '_shared.filter',
    presentUpstream: true,
    note: 'verified via Meta-Docs (see module doc comment above), not the vendored sample — D-004 closed 2026-08-20',
  },
  {
    path: '_shared.exclude-filter',
    presentUpstream: true,
    note: 'verified via Meta-Docs (see module doc comment above), not the vendored sample — D-004 closed 2026-08-20',
  },
  {
    path: 'exclude-type',
    presentUpstream: true,
    note: "real, documented alongside filter/exclude-filter (Meta-Docs), but not in plan #11's explicit P0 field range — deliberately unmodelled, reaches the user through the unknown-field tree",
  },
];

/**
 * proxy-groups (PRD §8.3 P0: Select、URL-Test、Fallback、Load-Balance). Same
 * discriminated-union shape as `proxies`/`proxy-providers` — `type` picks
 * the branch, shared fields apply regardless of it. Field grain follows
 * plan #1's explicit scope (`docs/releases/plans/v0.4.0.md` #1 "实现要点"):
 * `name`/`proxies`/`use`/`filter`/`exclude-filter` shared, plus each
 * branch's own `url`/`interval`/`tolerance`/`lazy`/`strategy`. Other real,
 * documented fields (`disable-udp`, `timeout`, `max-failed-times`,
 * `expected-status`, `hidden`, `icon`, `include-all*`, `exclude-type`,
 * deprecated `interface-name`/`routing-mark`) are deliberately outside this
 * version's P0 range — they reach the user through the unknown-field tree,
 * not silently dropped.
 */
const PROXY_GROUPS_FIELDS: UpstreamFieldRecord[] = [
  { path: '_shared.name', presentUpstream: true },
  { path: '_shared.type', presentUpstream: true, note: 'the discriminator key' },
  { path: '_shared.proxies', presentUpstream: true },
  { path: '_shared.use', presentUpstream: true, note: 'line 1712-1713 (UseProvider group)' },
  { path: '_shared.filter', presentUpstream: true, note: 'line 1711' },
  {
    path: '_shared.exclude-filter',
    presentUpstream: true,
    note: 'verified via Meta-Docs (github.com/MetaCubeX/Meta-Docs, docs/config/proxy-groups/index.md, commit 89c2f10, retrieved 2026-08-25) — not directly demonstrated in the vendored sample, which only shows `filter:` at line 1711',
  },

  // url-test
  { path: 'url-test.url', presentUpstream: true, note: 'line 1674' },
  { path: 'url-test.interval', presentUpstream: true, note: 'line 1675' },
  {
    path: 'url-test.tolerance',
    presentUpstream: true,
    note: 'commented out in the sample (`# tolerance: 150`, line 1671) but a documented url-test-specific option',
  },
  {
    path: 'url-test.lazy',
    presentUpstream: true,
    note: 'commented out in the sample (`# lazy: true`, line 1672); also the generic `lazy` field Meta-Docs documents (default true, health checks skipped while not the selected group)',
  },

  // fallback
  { path: 'fallback.url', presentUpstream: true, note: 'line 1684' },
  { path: 'fallback.interval', presentUpstream: true, note: 'line 1685' },

  // load-balance
  { path: 'load-balance.url', presentUpstream: true, note: 'line 1694' },
  { path: 'load-balance.interval', presentUpstream: true, note: 'line 1695' },
  {
    path: 'load-balance.strategy',
    presentUpstream: true,
    note: 'commented out in the sample (`# strategy: consistent-hashing`, line 1696) but load-balance-specific',
  },
];

/**
 * rule-providers (PRD §8.3 P0: HTTP/File/Inline、Classical/Domain/IPCIDR、
 * YAML/Text/MRS). Same discriminated-union shape as `proxy-providers` —
 * `type` picks http/file/inline. Field grain follows plan #2's explicit
 * scope: `behavior`/`format`/`interval`/`path`/`size-limit`/`proxy`
 * attributed to the branch(es) they apply to, plus `type` (discriminator)
 * and `url` (obviously required for `http`, omitted from the plan's prose
 * list the same way the word "type" itself is). `header` is real (shown in
 * both the vendored `proxy-providers` example and the official
 * rule-provider example) but outside plan #2's explicit field range —
 * reaches the user through the unknown-field tree, matching how
 * `proxy-providers.exclude-type` was left unmodelled in v0.3.0 #11.
 */
const RULE_PROVIDERS_FIELDS: UpstreamFieldRecord[] = [
  {
    path: '_shared.type',
    presentUpstream: true,
    note: 'http | file | inline; line 1850/1858/1872/1879',
  },
  {
    path: '_shared.behavior',
    presentUpstream: true,
    note: 'domain | ipcidr | classical; every one of the four vendored examples (rule1-rule4) sets it — lines 1847/1855/1875/1880',
  },

  { path: 'http.url', presentUpstream: true, note: 'line 1851/1873; required for type: http' },
  {
    path: 'http.format',
    presentUpstream: true,
    note: 'line 1874, the only literal `format:` in the sample; default yaml per Meta-Docs',
  },
  { path: 'http.interval', presentUpstream: true, note: 'line 1848' },
  { path: 'http.path', presentUpstream: true, note: 'optional local cache location; line 1849' },
  {
    path: 'http.size-limit',
    presentUpstream: true,
    note: 'commented out in the sample (`# size-limit: 10240`, line 1853) but a documented http-fetch option',
  },
  {
    path: 'http.proxy',
    presentUpstream: true,
    note: 'dialer used to fetch the provider itself; line 1852',
  },

  {
    path: 'file.format',
    presentUpstream: true,
    note: 'verified via Meta-Docs (docs/config/rule-providers/index.md, commit 89c2f10, retrieved 2026-08-25) — format is generic to any on-disk ruleset file, not restricted to type: http by the doc text; not directly demonstrated on the file branch in the vendored sample',
  },
  { path: 'file.interval', presentUpstream: true, note: 'line 1856 (rule2, type: file)' },
  {
    path: 'file.path',
    presentUpstream: true,
    note: 'required source file for the file type; line 1857',
  },

  {
    path: 'inline.payload',
    presentUpstream: true,
    note: 'inline provider only (type: inline); lines 1881-1884',
  },
];

const META_DOCS_RULES_EVIDENCE =
  'verified via Meta-Docs (github.com/MetaCubeX/Meta-Docs, docs/config/rules/index.md, commit 89c2f10, retrieved 2026-08-25) — not demonstrated anywhere in the vendored v1.19.29 sample';

export interface UpstreamRuleTypeRecord {
  /** Upper-case rule type token exactly as it appears in a rule line, e.g. `DOMAIN-SUFFIX`. */
  type: string;
  /**
   * PRD §8.3 "路由规则" P0 range (常用域名、IP、端口、进程、GEO、RULE-SET、
   * MATCH) vs P1/P2 (逻辑规则 explicitly, plus the advanced source/inbound/
   * process-matching variants PRD's "常用" wording does not reach).
   */
  p0: boolean;
  /** False only for MATCH, whose line is `MATCH,<target>` with no payload segment at all. */
  payloadRequired: boolean;
  /**
   * Mirrors `config-model/src/rule-line.ts`'s `LAST_SEGMENT_IS_TARGET`:
   * true means the target is the line's last comma-separated segment (used
   * where the payload itself may contain commas — regex/logic/sub-rule
   * payloads); false means the fixed third segment.
   */
  lastSegmentIsTarget: boolean;
  /** Where this type's existence as a `rules:`/`sub-rules:` entry was verified. */
  evidence: 'vendored-sample' | 'meta-docs';
  note?: string;
}

/**
 * The full rule-type catalog Mihomo documents for `rules:`/`sub-rules:`
 * entries (Meta-Docs `docs/config/rules/index.md`), hand-transcribed and
 * split into this version's P0 range and everything else. This is the
 * comparison object #3's `rule-types.json` catalog (ADR-021) asserts
 * against in both directions — the same role `UPSTREAM_P0_FIELDS` plays for
 * the object-shaped modules. `RULES_FIELDS` below is *derived* from this
 * list rather than hand-duplicated, so there is exactly one place these
 * facts are recorded.
 *
 * Sixteen of the thirty-seven types are P0. Twelve of those sixteen are
 * directly demonstrated in the vendored sample's `rules:` (1886-1897) or
 * `sub-rules:` (1914-1921) sections, or in the DNS `fake-ip-filter` list,
 * whose own comment (line 279) states it shares syntax with routing rules.
 * `GEOIP`/`DST-PORT`/`PROCESS-NAME`/`PROCESS-PATH` are real, PRD-named P0
 * types the vendored sample never demonstrates in either list — verified
 * against the official Meta-Docs source instead, the same D-004 precedent
 * `proxy-providers.filter`/`exclude-filter` used in v0.3.0. `DST-PORT` was
 * chosen as the sole P0 "端口" representative over `SRC-PORT`
 * (destination-port routing is the overwhelmingly common case); the P1/P2
 * source/inbound-criteria variants are recorded, not modelled.
 */
export const UPSTREAM_RULE_TYPES: readonly UpstreamRuleTypeRecord[] = [
  // --- P0 (PRD §8.3 常用域名、IP、端口、进程、GEO、RULE-SET、MATCH) ---
  {
    type: 'DOMAIN',
    p0: true,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'vendored-sample',
    note: 'sub-rules lines 1916/1917/1921',
  },
  {
    type: 'DOMAIN-SUFFIX',
    p0: true,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'vendored-sample',
    note: 'line 1890',
  },
  {
    type: 'DOMAIN-KEYWORD',
    p0: true,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'vendored-sample',
    note: 'line 1891',
  },
  {
    type: 'DOMAIN-WILDCARD',
    p0: true,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'vendored-sample',
    note: 'line 1892',
  },
  {
    type: 'DOMAIN-REGEX',
    p0: true,
    payloadRequired: true,
    lastSegmentIsTarget: true,
    evidence: 'vendored-sample',
    note: 'line 1889; LAST_SEGMENT_IS_TARGET because the regex payload may itself contain a comma',
  },
  {
    type: 'GEOSITE',
    p0: true,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'vendored-sample',
    note: 'line 282, DNS fake-ip-filter list — its own comment (line 279) states the syntax is shared with routing rules; standalone use in rules: confirmed by Meta-Docs',
  },
  {
    type: 'IP-CIDR',
    p0: true,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'vendored-sample',
    note: 'line 1893/1919/1920',
  },
  {
    type: 'IP-CIDR6',
    p0: true,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'vendored-sample',
    note: 'line 1894; an alias of IP-CIDR for v6 ranges per Meta-Docs',
  },
  {
    type: 'IP-ASN',
    p0: true,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'vendored-sample',
    note: 'line 1888',
  },
  {
    type: 'GEOIP',
    p0: true,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'meta-docs',
    note: META_DOCS_RULES_EVIDENCE,
  },
  {
    type: 'DST-PORT',
    p0: true,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'meta-docs',
    note: `${META_DOCS_RULES_EVIDENCE}; chosen as the P0 "端口" representative over SRC-PORT`,
  },
  {
    type: 'PROCESS-NAME',
    p0: true,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'meta-docs',
    note: META_DOCS_RULES_EVIDENCE,
  },
  {
    type: 'PROCESS-PATH',
    p0: true,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'meta-docs',
    note: META_DOCS_RULES_EVIDENCE,
  },
  {
    type: 'RULE-SET',
    p0: true,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'vendored-sample',
    note: 'line 1887; payload is a rule-providers name (a reference, not a literal value)',
  },
  {
    type: 'SUB-RULE',
    p0: true,
    payloadRequired: false,
    lastSegmentIsTarget: true,
    evidence: 'vendored-sample',
    note: 'lines 1896-1897; target is a sub-rule name, not a proxy/group — LAST_SEGMENT_IS_TARGET, payload is the nested logic expression (raw-only, logic is Out of scope)',
  },
  {
    type: 'MATCH',
    p0: true,
    payloadRequired: false,
    lastSegmentIsTarget: false,
    evidence: 'vendored-sample',
    note: 'line 286 (fake-ip-filter) and Meta-Docs `MATCH,auto`; no payload segment at all, parseRuleLine special-cases it',
  },

  // --- P1/P2 (逻辑规则 explicitly Out of scope, plus advanced variants PRD's "常用" wording does not reach) ---
  {
    type: 'IP-SUFFIX',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'meta-docs',
    note: META_DOCS_RULES_EVIDENCE,
  },
  {
    type: 'SRC-GEOIP',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'meta-docs',
    note: META_DOCS_RULES_EVIDENCE,
  },
  {
    type: 'SRC-IP-ASN',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'meta-docs',
    note: META_DOCS_RULES_EVIDENCE,
  },
  {
    type: 'SRC-IP-CIDR',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'meta-docs',
    note: META_DOCS_RULES_EVIDENCE,
  },
  {
    type: 'SRC-IP-SUFFIX',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'meta-docs',
    note: META_DOCS_RULES_EVIDENCE,
  },
  {
    type: 'SRC-PORT',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'meta-docs',
    note: META_DOCS_RULES_EVIDENCE,
  },
  {
    type: 'IN-PORT',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'meta-docs',
    note: META_DOCS_RULES_EVIDENCE,
  },
  {
    type: 'IN-TYPE',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'meta-docs',
    note: META_DOCS_RULES_EVIDENCE,
  },
  {
    type: 'IN-USER',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'meta-docs',
    note: META_DOCS_RULES_EVIDENCE,
  },
  {
    type: 'IN-NAME',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'meta-docs',
    note: META_DOCS_RULES_EVIDENCE,
  },
  {
    type: 'REMATCH-NAME',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'meta-docs',
    note: `${META_DOCS_RULES_EVIDENCE}; tied to the advanced rematch outbound feature`,
  },
  {
    type: 'PROCESS-PATH-WILDCARD',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'meta-docs',
    note: META_DOCS_RULES_EVIDENCE,
  },
  {
    type: 'PROCESS-PATH-REGEX',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: true,
    evidence: 'meta-docs',
    note: `${META_DOCS_RULES_EVIDENCE}; LAST_SEGMENT_IS_TARGET already in config-model/src/rule-line.ts`,
  },
  {
    type: 'PROCESS-NAME-WILDCARD',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'meta-docs',
    note: META_DOCS_RULES_EVIDENCE,
  },
  {
    type: 'PROCESS-NAME-REGEX',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: true,
    evidence: 'meta-docs',
    note: `${META_DOCS_RULES_EVIDENCE}; LAST_SEGMENT_IS_TARGET already in config-model/src/rule-line.ts`,
  },
  {
    type: 'UID',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'meta-docs',
    note: `${META_DOCS_RULES_EVIDENCE}; Linux-only`,
  },
  {
    type: 'NETWORK',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'vendored-sample',
    note: 'nested inside a SUB-RULE payload at lines 1896-1897 (not as a standalone rules: entry there); standalone use confirmed by Meta-Docs',
  },
  {
    type: 'DSCP',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: false,
    evidence: 'meta-docs',
    note: `${META_DOCS_RULES_EVIDENCE}; tproxy udp inbound only`,
  },
  {
    type: 'AND',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: true,
    evidence: 'vendored-sample',
    note: 'nested inside a SUB-RULE payload at line 1897 (not as a standalone rules: entry there); standalone use + LAST_SEGMENT_IS_TARGET confirmed by Meta-Docs. Explicitly Out of scope (PRD §8.3 P1/P2 "逻辑规则") — must remain raw-string-only (FR-RULE-05)',
  },
  {
    type: 'OR',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: true,
    evidence: 'vendored-sample',
    note: 'nested inside a SUB-RULE payload at line 1896 (not as a standalone rules: entry there); standalone use + LAST_SEGMENT_IS_TARGET confirmed by Meta-Docs. Explicitly Out of scope (PRD §8.3 P1/P2 "逻辑规则") — must remain raw-string-only (FR-RULE-05)',
  },
  {
    type: 'NOT',
    p0: false,
    payloadRequired: true,
    lastSegmentIsTarget: true,
    evidence: 'meta-docs',
    note: `${META_DOCS_RULES_EVIDENCE}; LAST_SEGMENT_IS_TARGET already in config-model/src/rule-line.ts. Explicitly Out of scope (PRD §8.3 P1/P2 "逻辑规则") — must remain raw-string-only (FR-RULE-05)`,
  },
];

/**
 * Coarse P0-membership view of `UPSTREAM_RULE_TYPES`, in the same
 * `UpstreamFieldRecord` shape every other module uses, so the existing
 * cross-module structural tests (module-id set, "every absent entry has a
 * note") stay uniform across all ten modules. Derived, not hand-duplicated
 * — `UPSTREAM_RULE_TYPES` is the one place these facts are recorded.
 * Literal-text traceability for this module uses comma syntax (`TYPE,`),
 * not the `key:` pattern the generic check uses — see `upstream.test.ts`.
 */
const RULES_FIELDS: UpstreamFieldRecord[] = UPSTREAM_RULE_TYPES.map((rule) => {
  const note = rule.p0
    ? rule.note
    : `P1/P2: ${rule.note ?? "not in this version's P0 rule-type range"}`;
  return note !== undefined
    ? { path: rule.type, presentUpstream: true, note }
    : { path: rule.type, presentUpstream: true };
});

/**
 * sub-rules (PRD §8.3 P0: 基础列表与引用). This module has no field
 * vocabulary of its own — a sub-rule's list items are rule lines using the
 * exact same DSL as `rules` (see `UPSTREAM_RULE_TYPES`), so this records
 * only its distinct shape: a map from sub-rule name to an array of rule
 * lines, and the `SUB-RULE` type (in `UPSTREAM_RULE_TYPES`) is the
 * reference mechanism that points into it.
 */
const SUB_RULES_FIELDS: UpstreamFieldRecord[] = [
  {
    path: 'sub-rules',
    presentUpstream: true,
    note: 'name -> array of rule lines, lines 1914-1921; same DSL as rules:, no separate field vocabulary of its own — see UPSTREAM_RULE_TYPES',
  },
];

export interface RuleProviderConstraint {
  /** Human-readable summary of the constraint. */
  description: string;
  /** Whether this version's rule-providers `validation.rules.json` (plan #2) encodes this as a real cross-field rule. */
  modeledThisVersion: boolean;
  /** Where this was verified — at least one source; two when cross-checked. */
  evidence: readonly string[];
  note?: string;
}

/**
 * Cross-field constraints on `rule-providers` entries, verified this round
 * against two independent sources: the vendored v1.19.29 sample's own
 * comment block and the official Meta-Docs page. The first entry closes the
 * sole prerequisite `docs/releases/v0.4.0-rules-and-graph.md` names
 * (`format: mrs` ⇒ `behavior`) and the matching `upstream-divergences.md`
 * "待核对项" row.
 */
export const UPSTREAM_RULE_PROVIDER_CONSTRAINTS: readonly RuleProviderConstraint[] = [
  {
    description:
      'format: mrs constrains behavior to domain or ipcidr — classical is not supported for mrs',
    modeledThisVersion: true,
    evidence: [
      'vendored sample lines 1860-1870 (comment block on rule3): "mrs类型ruleset，目前仅支持domain和ipcidr(即不支持classical）"',
      'Meta-Docs docs/config/rule-providers/index.md (commit 89c2f10, retrieved 2026-08-25): "mrs目前 behavior 仅支持 domain/ipcidr"',
    ],
    note: 'plan #2 encodes this in validation.rules.json using the existing closed Condition DSL operator set, no new operator',
  },
  {
    description:
      'a RULE-SET referenced by dns.fake-ip-filter or dns.nameserver-policy must have behavior in {domain, classical} — ipcidr is not valid there',
    modeledThisVersion: false,
    evidence: [
      'vendored sample lines 272-273 (fake-ip-filter): "behavior 必须为 domain/classical"',
      'vendored sample line 365 (nameserver-policy): "behavior 必须为 domain/classical"',
    ],
    note: "cross-module constraint (dns <-> rule-providers); this version's rule-providers module (plan #2) only validates rule-providers entries in isolation — recorded here, deliberately not modelled, not silently dropped",
  },
];

export const UPSTREAM_P0_FIELDS: Record<P0ModuleId, UpstreamFieldRecord[]> = {
  general: GENERAL_FIELDS,
  dns: DNS_FIELDS,
  sniffer: SNIFFER_FIELDS,
  inbound: INBOUND_FIELDS,
  proxies: PROXIES_FIELDS,
  'proxy-providers': PROXY_PROVIDERS_FIELDS,
  'proxy-groups': PROXY_GROUPS_FIELDS,
  'rule-providers': RULE_PROVIDERS_FIELDS,
  rules: RULES_FIELDS,
  'sub-rules': SUB_RULES_FIELDS,
};
