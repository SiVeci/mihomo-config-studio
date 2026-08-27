export interface EgressSourceFile {
  readonly path: string;
  readonly content: string;
}

export interface EgressViolation {
  readonly path: string;
  readonly reason: string;
}

export interface EgressCheckResult {
  readonly ok: boolean;
  readonly violations: readonly EgressViolation[];
}

/**
 * The only `packages/**` file allowed to contain a network-call symbol
 * (decision F4): Bundle updates are the one legitimate reason `packages/**`
 * ever needs to leave the machine. Exact literal paths, not a glob or
 * prefix — a glob would silently widen as the tree grows; an exact-match
 * array only ever grants exactly what it lists, and a stale or mistyped
 * entry (e.g. after a rename) simply grants nothing rather than silently
 * matching a whole directory.
 *
 * Declared here ahead of `updater.ts` actually existing (v0.5.0 #3 ships
 * before #4): a real run against today's `packages/` tree finds no network
 * symbols at all, so this entry is inert until #4 lands the file — at which
 * point it is already permitted, so #4's own CI run does not need this tool
 * touched again.
 */
export const EGRESS_ALLOWLIST: readonly string[] = ['packages/schema-registry/src/updater.ts'];

const NETWORK_SYMBOL_PATTERN = /\b(fetch|XMLHttpRequest|WebSocket|navigator\.sendBeacon)\s*\(/;
const METHOD_VALUE_PATTERN = /\bmethod\s*:\s*['"]([A-Za-z]+)['"]/;
const BODY_OPTION_PATTERN = /\bbody\s*:/;

function isTestFile(path: string): boolean {
  return path.endsWith('.test.ts') || path.endsWith('.test.tsx');
}

/**
 * Form-level check for the one allowlisted file (decision F4): even there,
 * only a bodyless `GET` is permitted. NFR-SEC-01's substance is "never
 * uploads configuration" — a request with no body has nothing to upload,
 * which is a stronger, structural guarantee than reviewing request content
 * after the fact.
 */
function checkAllowlistedForm(content: string): string | null {
  if (BODY_OPTION_PATTERN.test(content)) {
    return 'fetch call includes a body option — updater requests must never upload configuration (NFR-SEC-01)';
  }
  const methodMatch = content.match(METHOD_VALUE_PATTERN);
  if (methodMatch && methodMatch[1]!.toUpperCase() !== 'GET') {
    return 'fetch call uses a method other than GET';
  }
  return null;
}

/**
 * Source-text scan, same technique `checkManifestXml`
 * (`tools/android-manifest-check`) uses for a release gate: a static string
 * match, not a runtime interceptor. It cannot catch obfuscated or
 * dynamically-constructed calls; it can and does catch every literal
 * `fetch(`/`XMLHttpRequest`/`WebSocket`/`navigator.sendBeacon(` call, which
 * is what the four original negative cases require. Test files are exempt
 * (mirrors the previous inline CI grep's `grep -v '\.test\.ts'` filter) —
 * they are not shipped runtime code.
 */
export function checkEgress(files: readonly EgressSourceFile[]): EgressCheckResult {
  const violations: EgressViolation[] = [];

  for (const file of files) {
    if (isTestFile(file.path)) continue;
    if (!NETWORK_SYMBOL_PATTERN.test(file.content)) continue;

    if (!EGRESS_ALLOWLIST.includes(file.path)) {
      violations.push({
        path: file.path,
        reason: 'network call symbol found outside the egress allowlist (NFR-SEC-01)',
      });
      continue;
    }

    const formIssue = checkAllowlistedForm(file.content);
    if (formIssue) {
      violations.push({ path: file.path, reason: formIssue });
    }
  }

  return { ok: violations.length === 0, violations };
}
