import { IndexedDbStorageAdapter } from '@mcs/storage';
import { useMemo, type ReactNode } from 'react';

import { t } from './i18n/index.js';
import { ProjectPage } from './project/ProjectPage.js';
import { HashRouter, Routes, useRoutePath } from './router.js';
import type { Route } from './router.js';

/**
 * Constructs the real, browser-backed storage adapter lazily (inside a
 * render, not at module scope): `IndexedDbStorageAdapter`'s constructor
 * throws where `indexedDB` is unavailable, so building one eagerly at import
 * time would break any tooling that imports this module outside a browser.
 */
function ProjectPageRoute(): ReactNode {
  const adapter = useMemo(() => new IndexedDbStorageAdapter(), []);
  return <ProjectPage adapter={adapter} />;
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
