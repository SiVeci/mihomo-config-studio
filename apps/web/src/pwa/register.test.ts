// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { isNativePlatform } = vi.hoisted(() => ({ isNativePlatform: vi.fn() }));
vi.mock('../platform/capacitor.js', () => ({ isNativePlatform }));

function fakeServiceWorker() {
  const listeners = new Map<string, Array<() => void>>();
  return {
    state: 'installing',
    postMessage: vi.fn(),
    addEventListener: vi.fn((type: string, listener: () => void) => {
      const existing = listeners.get(type) ?? [];
      existing.push(listener);
      listeners.set(type, existing);
    }),
    fire(type: string): void {
      for (const listener of listeners.get(type) ?? []) {
        listener();
      }
    },
  };
}

function fakeRegistration() {
  const listeners = new Map<string, Array<() => void>>();
  return {
    waiting: null as ReturnType<typeof fakeServiceWorker> | null,
    installing: null as ReturnType<typeof fakeServiceWorker> | null,
    addEventListener: vi.fn((type: string, listener: () => void) => {
      const existing = listeners.get(type) ?? [];
      existing.push(listener);
      listeners.set(type, existing);
    }),
    fire(type: string): void {
      for (const listener of listeners.get(type) ?? []) {
        listener();
      }
    },
  };
}

function installFakeServiceWorkerContainer() {
  const listeners = new Map<string, Array<() => void>>();
  const container = {
    controller: null as object | null,
    register: vi.fn(),
    addEventListener: vi.fn((type: string, listener: () => void) => {
      const existing = listeners.get(type) ?? [];
      existing.push(listener);
      listeners.set(type, existing);
    }),
    fire(type: string): void {
      for (const listener of listeners.get(type) ?? []) {
        listener();
      }
    },
  };
  Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
  return container;
}

describe('registerServiceWorker (PRD §11.4, ADR-029, v0.6.0 #7)', () => {
  const originalLocation = window.location;
  const reload = vi.fn();

  beforeEach(() => {
    isNativePlatform.mockReturnValue(false);
    reload.mockClear();
    // jsdom's real `window.location.reload` has a non-configurable
    // descriptor — `vi.spyOn` can't touch it directly, so the whole
    // `location` object is swapped for a plain mutable stand-in instead.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    vi.restoreAllMocks();
    vi.resetModules();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('does nothing on a native (Capacitor) platform, even when the browser supports service workers', async () => {
    isNativePlatform.mockReturnValue(true);
    const container = installFakeServiceWorkerContainer();
    const { registerServiceWorker } = await import('./register.js');

    registerServiceWorker(() => undefined);
    window.dispatchEvent(new Event('load'));

    expect(container.register).not.toHaveBeenCalled();
  });

  it('does nothing when the browser has no serviceWorker support at all — offline is a progressive enhancement, not a hard requirement', async () => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    const { registerServiceWorker } = await import('./register.js');

    expect(() => {
      registerServiceWorker(() => undefined);
      window.dispatchEvent(new Event('load'));
    }).not.toThrow();
  });

  it('registers /sw.js immediately when the document has already finished loading — the common case, since this runs from a React effect well after the page loaded', async () => {
    const container = installFakeServiceWorkerContainer();
    container.register.mockResolvedValue(fakeRegistration());
    const { registerServiceWorker } = await import('./register.js');
    expect(document.readyState).toBe('complete');

    registerServiceWorker(() => undefined);

    expect(container.register).toHaveBeenCalledWith('/sw.js');
  });

  it('defers registration until the load event when the document has not finished loading yet — an event listener attached after `load` already fired would otherwise never run', async () => {
    const container = installFakeServiceWorkerContainer();
    container.register.mockResolvedValue(fakeRegistration());
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'loading' });
    try {
      const { registerServiceWorker } = await import('./register.js');

      registerServiceWorker(() => undefined);
      expect(container.register).not.toHaveBeenCalled();

      window.dispatchEvent(new Event('load'));

      expect(container.register).toHaveBeenCalledWith('/sw.js');
    } finally {
      Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
    }
  });

  it('reports an update immediately when the registration already has a waiting worker and something already controls the page', async () => {
    const container = installFakeServiceWorkerContainer();
    container.controller = {};
    const registration = fakeRegistration();
    registration.waiting = fakeServiceWorker();
    container.register.mockResolvedValue(registration);
    const onUpdateAvailable = vi.fn();
    const { registerServiceWorker } = await import('./register.js');

    registerServiceWorker(onUpdateAvailable);
    window.dispatchEvent(new Event('load'));
    await Promise.resolve();
    await Promise.resolve();

    expect(onUpdateAvailable).toHaveBeenCalledOnce();
  });

  it('does not report an update from a waiting worker when nothing yet controls the page (first-ever install, not an update)', async () => {
    const container = installFakeServiceWorkerContainer();
    container.controller = null;
    const registration = fakeRegistration();
    registration.waiting = fakeServiceWorker();
    container.register.mockResolvedValue(registration);
    const onUpdateAvailable = vi.fn();
    const { registerServiceWorker } = await import('./register.js');

    registerServiceWorker(onUpdateAvailable);
    window.dispatchEvent(new Event('load'));
    await Promise.resolve();
    await Promise.resolve();

    expect(onUpdateAvailable).not.toHaveBeenCalled();
  });

  it('reports an update when a newly-installed worker reaches "installed" while the page already has a controller', async () => {
    const container = installFakeServiceWorkerContainer();
    container.controller = {};
    const registration = fakeRegistration();
    container.register.mockResolvedValue(registration);
    const onUpdateAvailable = vi.fn();
    const { registerServiceWorker } = await import('./register.js');

    registerServiceWorker(onUpdateAvailable);
    window.dispatchEvent(new Event('load'));
    await Promise.resolve();
    await Promise.resolve();

    const installing = fakeServiceWorker();
    registration.installing = installing;
    registration.fire('updatefound');
    installing.state = 'installed';
    installing.fire('statechange');

    expect(onUpdateAvailable).toHaveBeenCalledOnce();
  });

  it('does not report an update the very first time a worker installs (no prior controller)', async () => {
    const container = installFakeServiceWorkerContainer();
    container.controller = null;
    const registration = fakeRegistration();
    container.register.mockResolvedValue(registration);
    const onUpdateAvailable = vi.fn();
    const { registerServiceWorker } = await import('./register.js');

    registerServiceWorker(onUpdateAvailable);
    window.dispatchEvent(new Event('load'));
    await Promise.resolve();
    await Promise.resolve();

    const installing = fakeServiceWorker();
    registration.installing = installing;
    registration.fire('updatefound');
    installing.state = 'installed';
    installing.fire('statechange');

    expect(onUpdateAvailable).not.toHaveBeenCalled();
  });

  it('applyUpdate() posts SKIP_WAITING to the waiting worker', async () => {
    const container = installFakeServiceWorkerContainer();
    container.controller = {};
    const registration = fakeRegistration();
    const waiting = fakeServiceWorker();
    registration.waiting = waiting;
    container.register.mockResolvedValue(registration);
    let handle: { applyUpdate: () => void } | undefined;
    const { registerServiceWorker } = await import('./register.js');

    registerServiceWorker((h) => {
      handle = h;
    });
    window.dispatchEvent(new Event('load'));
    await Promise.resolve();
    await Promise.resolve();

    handle?.applyUpdate();

    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('does not reload on a first-ever install claiming an uncontrolled page (ADR-029: no session was running yet, but none should be swapped mid-load either)', async () => {
    const container = installFakeServiceWorkerContainer();
    container.controller = null;
    container.register.mockResolvedValue(fakeRegistration());
    const { registerServiceWorker } = await import('./register.js');

    registerServiceWorker(() => undefined);
    window.dispatchEvent(new Event('load'));

    container.fire('controllerchange');

    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads the page once after applyUpdate() is called and the controller changes', async () => {
    const container = installFakeServiceWorkerContainer();
    container.controller = {};
    const registration = fakeRegistration();
    const waiting = fakeServiceWorker();
    registration.waiting = waiting;
    container.register.mockResolvedValue(registration);
    let handle: { applyUpdate: () => void } | undefined;
    const { registerServiceWorker } = await import('./register.js');

    registerServiceWorker((h) => {
      handle = h;
    });
    window.dispatchEvent(new Event('load'));
    await Promise.resolve();
    await Promise.resolve();

    handle?.applyUpdate();
    container.fire('controllerchange');
    container.fire('controllerchange');

    expect(reload).toHaveBeenCalledOnce();
  });
});
