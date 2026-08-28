import { isPrecacheManifest } from './precache-manifest.js';

interface ExtendableEvent {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response> | Response): void;
}
interface ExtendableMessageEvent {
  readonly data: unknown;
}

/**
 * Narrow, file-local shadow of the ambient `self` — same reasoning as
 * `worker/config.worker.ts`'s own `declare const self`: the `webworker` lib
 * would type this correctly, but adding it project-wide collides with the
 * `dom` lib the rest of `apps/web` needs, and a per-file
 * `/// <reference lib="webworker" />` redeclares globals (`self` itself,
 * plus `caches`/`Cache`/`Request`/`Response`, which `dom` already declares
 * compatibly and this file uses as-is). Only the handful of
 * ServiceWorker-specific members actually used below are added here.
 */
declare const self: {
  addEventListener(type: 'install', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'activate', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
  addEventListener(type: 'message', listener: (event: ExtendableMessageEvent) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
};

// Injected at build time (`apps/web/vite.config.ts`'s `define`) with a
// fresh value on every build — the one thing this file needs to guarantee
// its own bundled bytes differ from the previous build's `sw.js`, which is
// what makes the browser's own byte-comparison update check ever notice a
// new version exists (ADR-029). The same value seeds the cache name below,
// so `activate` always knows exactly which cache is "this version" and can
// safely drop every other one.
declare const __SW_BUILD_ID__: string;

const CACHE_NAME = `mcs-precache-${__SW_BUILD_ID__}`;
const PRECACHE_MANIFEST_URL = '/precache-manifest.json';
const NAVIGATION_FALLBACK_URL = '/index.html';

async function precache(): Promise<void> {
  // `no-store`, not the default cache mode: this URL is unhashed and must
  // always be read fresh, or `install` could precache the *previous*
  // build's file list under the *new* cache name.
  const response = await fetch(PRECACHE_MANIFEST_URL, { cache: 'no-store' });
  const data: unknown = await response.json();
  if (!isPrecacheManifest(data)) {
    // A same-origin build artifact came back malformed — nothing sensible
    // to precache. Throwing fails `install` (the previous version's cache,
    // if any, is untouched since `activate`'s cleanup never runs), so the
    // app keeps working network-only rather than serving a half-populated
    // cache.
    throw new Error('mcs: precache manifest fetch returned an unexpected shape');
  }
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll([...data.files]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

async function dropStaleCaches(): Promise<void> {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith('mcs-precache-') && name !== CACHE_NAME)
      .map((name) => caches.delete(name)),
  );
}

self.addEventListener('activate', (event) => {
  event.waitUntil(dropStaleCaches().then(() => self.clients.claim()));
});

// The update-available banner (`apps/web/src/pwa/register.ts`) is the only
// caller — a new worker install completes and sits in `waiting` on its own
// (no `skipWaiting()` in the `install` handler above); it only takes over
// once the user explicitly asks for the refresh, via this message.
self.addEventListener('message', (event) => {
  if (event.data && (event.data as { type?: unknown }).type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

async function handleNavigation(request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch {
    // Offline, or the network request otherwise failed outright (not a
    // non-2xx response, which `fetch` resolves normally for) — serve the
    // precached shell rather than the browser's own offline error page.
    // `ignoreVary`: see the comment on the same option in
    // `handleStaticAsset` below.
    const cached = await caches.match(NAVIGATION_FALLBACK_URL, {
      cacheName: CACHE_NAME,
      ignoreVary: true,
    });
    if (cached) {
      return cached;
    }
    throw new Error('mcs: offline and no cached navigation fallback available');
  }
}

async function handleStaticAsset(request: Request): Promise<Response> {
  // `ignoreVary: true` — found by testing an actual offline reload rather
  // than trusting the logic: Vite marks the entry `<script>`/`<link>` tags
  // `crossorigin`, which makes `vite preview` answer with `Vary: Origin`.
  // The default vary-sensitive match then misses on the real browser
  // request (issued with an `Origin` header because of `crossorigin`)
  // against what `precache()` stored (no such header, fetched from the
  // worker's own context) — a real, reproducible cache miss on every
  // hashed asset. `ignoreVary` sidesteps it correctly: freshness here comes
  // from the content hash in the filename, never from HTTP negotiation, so
  // Vary-sensitivity was never buying anything to begin with.
  const cached = await caches.match(request, { cacheName: CACHE_NAME, ignoreVary: true });
  if (cached) {
    // Every precached asset besides index.html carries a content hash in
    // its filename (`vite.config.ts`'s `entryFileNames`/`assetFileNames`),
    // so a cache hit is correct by construction — never stale, nothing to
    // revalidate against the network.
    return cached;
  }
  return fetch(request);
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigation(event.request));
    return;
  }
  event.respondWith(handleStaticAsset(event.request));
});
