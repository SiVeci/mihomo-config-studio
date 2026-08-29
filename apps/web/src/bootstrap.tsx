import { cssVariables } from '@mcs/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { applyCssVariables } from './theme/apply-css-variables.js';

/**
 * The real app: React, `@mcs/ui`, and everything `App.tsx` pulls in. Built
 * as its own Rollup entry (`vite.config.ts`) rather than something
 * `main.tsx` statically imports, and loaded only via a plain injected
 * `<script>` tag once `main.tsx` has already confirmed capabilities
 * (ADR-027) — never reachable any other way, so this file's
 * `chrome107`-targeted syntax can never end up in the chunk an unsupported
 * WebView has to parse.
 *
 * `index.css` is imported from `main.tsx` instead of here, even though it
 * only matters once `mount()` runs: `main.tsx` needs it as a plain,
 * statically-linked `<link>` tag regardless of which entry loads it.
 */
export function mount(rootElement: HTMLElement): void {
  // Single source of truth (packages/ui#7): the CSS custom properties
  // consumed by index.css are generated from the same token data @mcs/ui
  // exports as TS, never hand-duplicated. Applied via the `style` attribute
  // (ADR-032), not an injected `<style>` element — see
  // apply-css-variables.ts's own doc comment for why that distinction
  // matters under a strict CSP.
  applyCssVariables(document.documentElement, cssVariables());

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found.');
}
mount(rootElement);
