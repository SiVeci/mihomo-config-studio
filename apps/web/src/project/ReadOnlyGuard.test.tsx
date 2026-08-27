// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n/index.js';
import { ReadOnlyGuard } from './ReadOnlyGuard.js';

afterEach(() => {
  cleanup();
});

describe('ReadOnlyGuard (ADR-004 point 6, PRD §9.5 point 3, v0.5.0 #12)', () => {
  it('shows the locked version in the banner text', () => {
    render(
      <ReadOnlyGuard lockedVersion="1.2.3" onUpgradeClick={vi.fn()}>
        <p>content</p>
      </ReadOnlyGuard>,
    );

    expect(screen.getByText(t('readonly.banner', { version: '1.2.3' }))).toBeDefined();
  });

  it('links to the Bundle management page', () => {
    render(
      <ReadOnlyGuard lockedVersion="1.2.3" onUpgradeClick={vi.fn()}>
        <p>content</p>
      </ReadOnlyGuard>,
    );

    const link = screen.getByRole<HTMLAnchorElement>('link', {
      name: t('readonly.goToBundlePage'),
    });
    expect(link.getAttribute('href')).toBe('#/bundle');
  });

  it('calls onUpgradeClick when the upgrade action is clicked', () => {
    const onUpgradeClick = vi.fn();
    render(
      <ReadOnlyGuard lockedVersion="1.2.3" onUpgradeClick={onUpgradeClick}>
        <p>content</p>
      </ReadOnlyGuard>,
    );

    fireEvent.click(screen.getByRole('button', { name: t('readonly.upgradeButton') }));

    expect(onUpgradeClick).toHaveBeenCalled();
  });

  it('renders its children (the read-only content) alongside the banner', () => {
    render(
      <ReadOnlyGuard lockedVersion="1.2.3" onUpgradeClick={vi.fn()}>
        <p>the wrapped read-only view</p>
      </ReadOnlyGuard>,
    );

    expect(screen.getByText('the wrapped read-only view')).toBeDefined();
  });
});
