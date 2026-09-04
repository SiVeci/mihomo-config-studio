// @vitest-environment jsdom
import { BUILTIN_MANIFEST } from '@mcs/schema-registry';
import { MemoryStorageAdapter } from '@mcs/storage';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CURRENT_APP_VERSION } from '../bundle/verify-options.js';
import { t } from '../i18n/index.js';
import { DEFAULT_TARGET_PROFILE } from '../project/model.js';
import { AboutPage } from './AboutPage.js';

afterEach(() => {
  cleanup();
});

describe('AboutPage (PRD §2.3, v1.0.0 #4)', () => {
  it('states the no-affiliation disclaimer (version doc §3 hard requirement)', () => {
    render(<AboutPage adapter={new MemoryStorageAdapter()} />);

    expect(screen.getByText(t('about.disclaimer.body'))).toBeDefined();
  });

  it('shows the app version and current compatibility profile, from build-time constants — never a network lookup', () => {
    render(<AboutPage adapter={new MemoryStorageAdapter()} />);

    expect(screen.getByText(CURRENT_APP_VERSION)).toBeDefined();
    expect(screen.getByText(DEFAULT_TARGET_PROFILE)).toBeDefined();
  });

  it('resolves and shows the active Bundle version and channel — the built-in Bundle when nothing has been installed', async () => {
    render(<AboutPage adapter={new MemoryStorageAdapter()} />);

    expect(screen.getByText(t('about.version.bundleLoading'))).toBeDefined();

    await waitFor(() => {
      expect(
        screen.getByText(
          t('about.version.bundleValue', {
            version: BUILTIN_MANIFEST.version,
            channel: BUILTIN_MANIFEST.channel,
          }),
        ),
      ).toBeDefined();
    });
  });

  it('links to the real LICENSE and SECURITY.md files (MIT license, ADR-015)', () => {
    render(<AboutPage adapter={new MemoryStorageAdapter()} />);

    const licenseLink = screen.getByRole('link', { name: 'LICENSE' });
    expect(licenseLink.getAttribute('href')).toBe(
      'https://github.com/SiVeci/mihomo-config-studio/blob/main/LICENSE',
    );

    const privacyLink = screen.getByRole('link', { name: t('about.privacy.link') });
    expect(privacyLink.getAttribute('href')).toBe(
      'https://github.com/SiVeci/mihomo-config-studio/blob/main/SECURITY.md',
    );
  });

  it('links back to the project list', () => {
    render(<AboutPage adapter={new MemoryStorageAdapter()} />);

    const backLink = screen.getByRole('link', { name: t('about.backToProject') });
    expect(backLink.getAttribute('href')).toBe('#/');
  });

  it('never fetches anything over the network (local-first, NFR-SEC boundary)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('AboutPage must never call fetch()');
    }) as typeof fetch;
    try {
      render(<AboutPage adapter={new MemoryStorageAdapter()} />);
      // Waits out the full async Bundle-resolution effect (the only async
      // work this component does) while the throwing `fetch` is still in
      // place — a synchronous-only check would pass even if a `fetch` call
      // were merely scheduled for after the assertion ran.
      await waitFor(() => {
        expect(screen.queryByText(t('about.version.bundleLoading'))).toBeNull();
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
