import { IndexedDbStorageAdapter } from '@mcs/storage';
import { useMemo, type ReactNode } from 'react';

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

function NotFoundPage(): ReactNode {
  const path = useRoutePath();
  return <p>{t('app.notFoundPath', { path })}</p>;
}

const ROUTES: readonly Route[] = [{ path: '/', element: <ProjectPageRoute /> }];

export function App(): ReactNode {
  return (
    <HashRouter>
      <Routes routes={ROUTES} notFound={<NotFoundPage />} />
    </HashRouter>
  );
}
