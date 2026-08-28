// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n/index.js';
import { BottomNav } from './BottomNav.js';

afterEach(() => {
  cleanup();
});

describe('BottomNav (PRD §7.3, v0.6.0 #6)', () => {
  it('renders exactly the four destinations the version document names', () => {
    render(<BottomNav active="config" onNavigate={vi.fn()} />);

    expect(screen.getByRole('button', { name: t('bottomNav.configTab') })).toBeDefined();
    expect(screen.getByRole('button', { name: t('bottomNav.graphTab') })).toBeDefined();
    expect(screen.getByRole('button', { name: t('bottomNav.yamlTab') })).toBeDefined();
    expect(screen.getByRole('button', { name: t('bottomNav.issuesTab') })).toBeDefined();
  });

  it('marks only the active destination with aria-current', () => {
    render(<BottomNav active="yaml" onNavigate={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: t('bottomNav.yamlTab') }).getAttribute('aria-current'),
    ).toBe('page');
    expect(
      screen.getByRole('button', { name: t('bottomNav.configTab') }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('calls onNavigate with the clicked destination', () => {
    const onNavigate = vi.fn();
    render(<BottomNav active="config" onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('button', { name: t('bottomNav.issuesTab') }));

    expect(onNavigate).toHaveBeenCalledWith('issues');
  });
});
