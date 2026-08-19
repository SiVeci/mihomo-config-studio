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

/** The six P0 modules this version covers (PRD §8.3, "配置模块覆盖" table). */
export const P0_MODULE_IDS = [
  'general',
  'dns',
  'sniffer',
  'inbound',
  'proxies',
  'proxy-providers',
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
   * For `general`/`dns`/`sniffer`/`inbound`/`proxy-providers`: a dot path
   * into the document (e.g. `profile.store-selected`), or a bare top-level
   * key. For `proxies`: `_shared.<field>` for a field common to every P0
   * protocol, `<protocol>.<field>` for a protocol-specific field, or a bare
   * `<type>` naming a whole protocol this version deliberately does not
   * cover (see `note`).
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
 * modules sharing the document root is a real design question for #6/#8,
 * not resolved by this inventory.
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
];

/**
 * dns (PRD §8.3 P0: enable、listen、enhanced-mode、fake-ip、nameserver、
 * fallback、policy、hosts). Structural note: `hosts` is a *document-root*
 * key upstream (line 119), not nested under `dns:` — despite PRD grouping
 * it with DNS conceptually.
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
  { path: 'dns.nameserver-policy', presentUpstream: true },
  {
    path: 'hosts',
    presentUpstream: true,
    note: 'document-root key, not `dns.hosts` — see module note above',
  },
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
 * `filter`/`exclude-filter` are demonstrated on a proxy-*group*'s `use:`
 * (line 1711 of the vendored sample: `filter: "HK|TW"`), never directly on
 * a `proxy-providers` entry — despite being documented Mihomo
 * provider-level fields elsewhere. See D-004 in `upstream-divergences.md`.
 */
const PROXY_PROVIDERS_FIELDS: UpstreamFieldRecord[] = [
  { path: 'type', presentUpstream: true, note: 'http | file | inline' },
  {
    path: 'url',
    presentUpstream: true,
    note: 'NFR-SEC-02: subscription URL, must be `sensitive: true`',
  },
  { path: 'interval', presentUpstream: true },
  { path: 'path', presentUpstream: true },
  { path: 'proxy', presentUpstream: true, note: 'dialer used to fetch the provider itself' },
  { path: 'header', presentUpstream: true },
  { path: 'payload', presentUpstream: true, note: 'inline provider only (type: inline)' },
  { path: 'health-check', presentUpstream: true },
  { path: 'health-check.enable', presentUpstream: true },
  { path: 'health-check.interval', presentUpstream: true },
  {
    path: 'health-check.url',
    presentUpstream: true,
    note: 'probe URL, NOT sensitive — same-named `url` field one level up (the subscription address) is; see project-format ADR-018 heuristic-vs-Schema note',
  },
  { path: 'override', presentUpstream: true },
  { path: 'override.skip-cert-verify', presentUpstream: true },
  { path: 'override.udp', presentUpstream: true },
  {
    path: 'filter',
    presentUpstream: false,
    note: 'PRD §8.3 lists "过滤" as P0, but this sample only demonstrates `filter` on a proxy-group\'s `use:` (line 1711), never on a proxy-providers entry directly — needs separate verification against upstream source/docs when #11 implements it; see D-004',
  },
  {
    path: 'exclude-filter',
    presentUpstream: false,
    note: 'see the `filter` entry above; same open question',
  },
];

export const UPSTREAM_P0_FIELDS: Record<P0ModuleId, UpstreamFieldRecord[]> = {
  general: GENERAL_FIELDS,
  dns: DNS_FIELDS,
  sniffer: SNIFFER_FIELDS,
  inbound: INBOUND_FIELDS,
  proxies: PROXIES_FIELDS,
  'proxy-providers': PROXY_PROVIDERS_FIELDS,
};
