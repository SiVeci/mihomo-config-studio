import { useEffect, useState, type ReactNode } from 'react';

import { t } from '../i18n/index.js';
import { registerServiceWorker } from './register.js';
import type { ServiceWorkerUpdateHandle } from './register.js';
import './UpdateBanner.css';

/**
 * PRD §11.4 / ADR-029: the only UI surface for the cache-versioning
 * strategy's forced-refresh entry. Renders nothing until
 * `registerServiceWorker` reports a worker sitting in `waiting` — which,
 * on Android, is never, since `registerServiceWorker` itself is a no-op
 * there (Capacitor loads this origin natively, no Service Worker involved).
 */
export function UpdateBanner(): ReactNode {
  const [handle, setHandle] = useState<ServiceWorkerUpdateHandle | null>(null);

  useEffect(() => {
    registerServiceWorker(setHandle);
  }, []);

  if (!handle) {
    return null;
  }

  return (
    <button type="button" className="update-banner" onClick={() => handle.applyUpdate()}>
      {t('pwa.updateBanner')}
    </button>
  );
}
