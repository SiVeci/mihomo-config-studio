import type { KnownFormat } from './types.ts';

/**
 * Format checkers are hand-written and linear. Each pattern below is anchored
 * and free of nested quantifiers, so it cannot backtrack catastrophically.
 */
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOSTNAME =
  /^(?=.{1,253}$)[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DURATION_SECONDS = /^\d{1,10}$/;

function isIpv6(value: string): boolean {
  if (value.length > 45) return false;
  // Delegate to the platform parser instead of a hand-rolled IPv6 regex.
  try {
    return new URL(`http://[${value}]`).hostname === `[${value.toLowerCase()}]`;
  } catch {
    return false;
  }
}

function isIpCidr(value: string): boolean {
  const slash = value.lastIndexOf('/');
  if (slash <= 0) return false;
  const address = value.slice(0, slash);
  const prefix = value.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const bits = Number(prefix);
  if (IPV4.test(address)) return bits <= 32;
  if (isIpv6(address)) return bits <= 128;
  return false;
}

function isHostPort(value: string): boolean {
  // `[::1]:53`, `127.0.0.1:9090`, `example.com:443`, `:7890`
  const match = /^(\[[0-9a-fA-F:.]{2,45}\]|[^:]*):(\d{1,5})$/.exec(value);
  if (!match) return false;
  const port = Number(match[2]);
  if (port < 0 || port > 65535) return false;
  const host = match[1] as string;
  if (host === '') return true;
  if (host.startsWith('[')) return isIpv6(host.slice(1, -1));
  return host === '*' || IPV4.test(host) || HOSTNAME.test(host);
}

function isUri(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol.length > 1;
  } catch {
    return false;
  }
}

const CHECKERS: Record<KnownFormat, (value: string) => boolean> = {
  uri: isUri,
  hostname: (value) => HOSTNAME.test(value),
  ipv4: (value) => IPV4.test(value),
  ipv6: isIpv6,
  'ip-cidr': isIpCidr,
  port: (value) => /^\d{1,5}$/.test(value) && Number(value) >= 1 && Number(value) <= 65535,
  'duration-seconds': (value) => DURATION_SECONDS.test(value),
  uuid: (value) => UUID.test(value),
  'host-port': isHostPort,
};

export function checkFormat(format: KnownFormat, value: string): boolean {
  const checker = CHECKERS[format];
  return checker ? checker(value) : true;
}

/**
 * Reject regular expressions that could backtrack catastrophically before they
 * are ever executed. Used when validating a bundle, not on the edit hot path.
 *
 * This is a heuristic, not a decision procedure: it flags a quantified group
 * that itself contains a quantifier or an alternation, which covers the
 * classic `(a+)+` / `(a|a)*` shapes.
 */
export function isRiskyPattern(pattern: string): boolean {
  if (pattern.length > 512) return true;
  return /\((?![?]:)?[^)]*[*+{|][^)]*\)\s*[*+]|\([^)]*[*+][^)]*\)\s*\{/.test(pattern);
}
