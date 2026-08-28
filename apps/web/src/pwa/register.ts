import { isNativePlatform } from '../platform/capacitor.js';

export interface ServiceWorkerUpdateHandle {
  /** Tells the waiting worker to take over, then reloads once it does. */
  readonly applyUpdate: () => void;
}

function notifyUpdateWaiting(
  worker: ServiceWorker,
  onUpdateAvailable: (handle: ServiceWorkerUpdateHandle) => void,
): void {
  onUpdateAvailable({
    applyUpdate: () => worker.postMessage({ type: 'SKIP_WAITING' }),
  });
}

function watchForUpdates(
  registration: ServiceWorkerRegistration,
  onUpdateAvailable: (handle: ServiceWorkerUpdateHandle) => void,
): void {
  // A worker can already be sitting in `waiting` by the time this runs (the
  // tab was opened, a background update check found a new version, and the
  // user never revisited the update banner from a previous page load).
  if (registration.waiting && navigator.serviceWorker.controller) {
    notifyUpdateWaiting(registration.waiting, onUpdateAvailable);
  }
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) {
      return;
    }
    installing.addEventListener('statechange', () => {
      // `installed` with an existing controller means some *other* version
      // already runs this page — this is an update, not the first-ever
      // install (which also passes through `installed` but has nothing to
      // notify about; `sw.ts` activates that case on its own).
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        notifyUpdateWaiting(installing, onUpdateAvailable);
      }
    });
  });
}

/**
 * PRD §11.4 / ADR-029. Never called on Android: `apps/android` loads this
 * same build's output from Capacitor's local `https://localhost` origin, so
 * a Cache Storage layer on top would only make "installed a new APK but the
 * WebView still shows the old build" harder to diagnose, not easier —
 * Android's update story is a fresh APK install, not this cache.
 *
 * Silently a no-op when the browser has no Service Worker support at all
 * (unlike `platform/capabilities.ts`'s gate, offline is a progressive
 * enhancement here, not a hard requirement — the app still fully works
 * online without it).
 */
export function registerServiceWorker(
  onUpdateAvailable: (handle: ServiceWorkerUpdateHandle) => void,
): void {
  if (isNativePlatform()) {
    return;
  }
  if (!('serviceWorker' in navigator)) {
    return;
  }

  function register(): void {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => watchForUpdates(registration, onUpdateAvailable))
      .catch(() => {
        // Registration can fail (e.g. `sw.js` 404s on a dev server that
        // never built it) — offline support is progressive, so the app
        // keeps working online-only rather than surfacing this anywhere.
      });
  }

  // This runs from a React effect well after the initial script tags were
  // injected (`main.tsx`), so by the time it does, `load` has often already
  // fired — an event listener attached after the fact never sees a past
  // event. `readyState` is checked first and `load` is only awaited when
  // the document genuinely has not finished yet.
  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register);
  }

  let reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Fires once per `applyUpdate()`, but guard anyway: a second, unrelated
    // controller change mid-reload must not queue a second reload.
    if (reloadedForUpdate) {
      return;
    }
    reloadedForUpdate = true;
    window.location.reload();
  });
}
