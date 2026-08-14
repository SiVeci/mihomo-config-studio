import type { ReactNode } from 'react';

import { t } from './i18n/index.js';
import { HashRouter, Routes, useRoutePath } from './router.js';
import type { Route } from './router.js';

function HomePage(): ReactNode {
  return (
    <main>
      <h1>{t('app.title')}</h1>
      <p>{t('app.tagline')}</p>
    </main>
  );
}

function NotFoundPage(): ReactNode {
  const path = useRoutePath();
  return <p>{t('app.notFoundPath', { path })}</p>;
}

const ROUTES: readonly Route[] = [{ path: '/', element: <HomePage /> }];

export function App(): ReactNode {
  return (
    <HashRouter>
      <Routes routes={ROUTES} notFound={<NotFoundPage />} />
    </HashRouter>
  );
}
