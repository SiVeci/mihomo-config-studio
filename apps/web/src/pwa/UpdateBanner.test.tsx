// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n/index.js';
import { UpdateBanner } from './UpdateBanner.js';
import type { ServiceWorkerUpdateHandle } from './register.js';

const { registerServiceWorker } = vi.hoisted(() => ({ registerServiceWorker: vi.fn() }));
vi.mock('./register.js', () => ({ registerServiceWorker }));

afterEach(() => {
  cleanup();
  registerServiceWorker.mockReset();
});

describe('UpdateBanner (PRD §11.4, ADR-029, v0.6.0 #7)', () => {
  it('renders nothing while no update is available', () => {
    render(<UpdateBanner />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the refresh prompt once registerServiceWorker reports an update', () => {
    let reportUpdate: ((handle: ServiceWorkerUpdateHandle) => void) | undefined;
    registerServiceWorker.mockImplementation((callback) => {
      reportUpdate = callback;
    });
    render(<UpdateBanner />);
    expect(screen.queryByRole('button')).toBeNull();

    act(() => {
      reportUpdate?.({ applyUpdate: vi.fn() });
    });

    expect(screen.getByRole('button', { name: t('pwa.updateBanner') })).toBeDefined();
  });

  it('calls applyUpdate when the banner is clicked', () => {
    const applyUpdate = vi.fn();
    registerServiceWorker.mockImplementation((callback) => {
      callback({ applyUpdate });
    });
    render(<UpdateBanner />);

    fireEvent.click(screen.getByRole('button', { name: t('pwa.updateBanner') }));

    expect(applyUpdate).toHaveBeenCalledOnce();
  });
});
