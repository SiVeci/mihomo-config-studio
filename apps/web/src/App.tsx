import { IndexedDbStorageAdapter } from '@mcs/storage';
import { useMemo, type ReactNode } from 'react';

import { BundlePage } from './bundle/BundlePage.js';
import { resolveUpdateSources } from './bundle/update-sources.js';
import { t } from './i18n/index.js';
import { ProjectPage } from './project/ProjectPage.js';
import { HashRouter, Routes, useRoutePath } from './router.js';
import type { Route } from './router.js';
import { createConfigWorkerClient } from './worker/client.js';

/**
 * Constructs the real, browser-backed storage adapter and Worker client
 * lazily (inside a render, not at module scope): both throw where their
 * platform dependency (`indexedDB`, `Worker`) is unavailable, so building
 * either eagerly at import time would break any tooling that imports this
 * module outside a browser.
 */
function ProjectPageRoute(): ReactNode {
  const adapter = useMemo(() => new IndexedDbStorageAdapter(), []);
  const client = useMemo(() => createConfigWorkerClient(), []);
  return <ProjectPage adapter={adapter} client={client} />;
}

/**
 * `/bundle` (decision F10): Bundle management is independent of whichever
 * project happens to be open and worth bookmarking/reloading into directly
 * — exactly the case `router.tsx`'s own doc comment names as the bar for
 * promoting something to a real route, unlike the main column's
 * form/rules/graph view switch (still `useState`, v0.4.0 #7).
 * `updateSources` is the build-time source map (v0.6.0 #0's local dev
 * source now, #12's GitHub Releases source later); a channel absent from
 * it renders the page's own "not configured" state.
 */
function BundlePageRoute(): ReactNode {
  const adapter = useMemo(() => new IndexedDbStorageAdapter(), []);
  const updateSources = useMemo(() => resolveUpdateSources(), []);
  return <BundlePage adapter={adapter} updateSources={updateSources} />;
}

function NotFoundPage(): ReactNode {
  const path = useRoutePath();
  return <p>{t('app.notFoundPath', { path })}</p>;
}

const ROUTES: readonly Route[] = [
  { path: '/', element: <ProjectPageRoute /> },
  { path: '/bundle', element: <BundlePageRoute /> },
];

export function App(): ReactNode {
  return (
    <HashRouter>
      <Routes routes={ROUTES} notFound={<NotFoundPage />} />
    </HashRouter>
  );
}
