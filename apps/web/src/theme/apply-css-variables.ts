const ROOT_BLOCK_PATTERN = /:root\s*\{([\s\S]*)\}/;

/** Parses `@mcs/ui`'s `cssVariables()` output (`:root { --name: value; ... }`) into individual `[name, value]` pairs — the string itself stays the single source of truth; this only changes how `apps/web` applies it. */
export function parseCssVariables(css: string): ReadonlyArray<readonly [string, string]> {
  const body = ROOT_BLOCK_PATTERN.exec(css)?.[1] ?? '';
  const pairs: [string, string][] = [];
  for (const declaration of body.split(';')) {
    const trimmed = declaration.trim();
    if (!trimmed) continue;
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;
    const name = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();
    if (name.startsWith('--') && value) pairs.push([name, value]);
  }
  return pairs;
}

/**
 * Applies every design-token CSS custom property directly via the `style`
 * IDL attribute rather than injecting a `<style>` element with the raw text
 * (ADR-032, NFR-SEC-07). Mutating `target.style` — whether through this
 * `setProperty` loop or a plain `style={{...}}` React prop — is governed by
 * CSP's `style-src-attr` directive; creating a `<style>` element is governed
 * by `style-src-elem`, which this app's strict policy locks to `'self'` with
 * no inline exception. `style-src-attr 'unsafe-inline'` is already allowed
 * for the per-element geometry values in `GraphView`/`RuleListPage`, so this
 * reuses an exception that already exists rather than needing a new one.
 */
export function applyCssVariables(target: HTMLElement, css: string): void {
  for (const [name, value] of parseCssVariables(css)) {
    target.style.setProperty(name, value);
  }
}
