import './index.css';
import { detectMissingCapabilities } from './platform/capabilities.js';
import { renderUnsupportedBrowser } from './platform/UnsupportedBrowser.js';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found.');
}

// Runs before anything else touches indexedDB/Worker/crypto.subtle or calls
// i18n's replaceAll (ADR-027). This file and its two imports are the ONLY
// statically-imported modules in the entry chunk — everything else (React,
// @mcs/ui, App and its whole tree) lives in bootstrap.tsx, a separate
// Rollup entry (vite.config.ts) loaded below via a plain injected
// `<script>` tag, specifically so a `chrome107`-targeted syntax construct
// anywhere in that much larger graph can never break parsing of *this*
// file. A dynamic `import()` call was tried first and rejected: Vite always
// wraps it in a `__vitePreload` runtime helper that itself uses `?.`,
// confirmed on a real Chrome 74 AVD to turn the whole entry chunk into a
// silent no-op (SyntaxError, nothing rendered, not even this gate). A
// `document.createElement('script')` call is vanilla DOM — invisible to
// Vite's import-analysis plugin, so nothing gets injected around it.
const missingCapabilities = detectMissingCapabilities(globalThis);
if (missingCapabilities.length > 0) {
  renderUnsupportedBrowser(rootElement, missingCapabilities);
} else {
  // Neither tag is in index.html's own markup (nothing there references
  // bootstrap.tsx), so Vite never gets the chance to inject them itself —
  // both are hardcoded to the stable filenames vite.config.ts's
  // `entryFileNames`/`assetFileNames` give this one entry.
  const bootstrapStyles = document.createElement('link');
  bootstrapStyles.rel = 'stylesheet';
  bootstrapStyles.href = '/assets/bootstrap.css';
  document.head.appendChild(bootstrapStyles);

  const bootstrapScript = document.createElement('script');
  bootstrapScript.type = 'module';
  bootstrapScript.src = '/assets/bootstrap.js';
  document.head.appendChild(bootstrapScript);
}
