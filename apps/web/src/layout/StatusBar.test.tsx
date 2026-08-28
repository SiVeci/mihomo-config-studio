// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n/index.js';
import { StatusBar } from './StatusBar.js';

afterEach(() => {
  cleanup();
});

describe('StatusBar (PRD §7.3, v0.6.0 #6)', () => {
  it('shows the project name and compatibility profile', () => {
    render(
      <StatusBar
        projectName="My Project"
        compatibilityProfile="v1.19.29"
        saveStatus="saved"
        onBack={() => undefined}
      />,
    );

    expect(screen.getByText('My Project')).toBeDefined();
    expect(screen.getByText('v1.19.29')).toBeDefined();
  });

  it('shows the saved label when saveStatus is saved', () => {
    render(
      <StatusBar
        projectName="My Project"
        compatibilityProfile="v1.19.29"
        saveStatus="saved"
        onBack={() => undefined}
      />,
    );

    expect(screen.getByText(t('statusBar.saved'))).toBeDefined();
    expect(screen.queryByText(t('statusBar.pending'))).toBeNull();
  });

  it('shows the pending label when saveStatus is pending', () => {
    render(
      <StatusBar
        projectName="My Project"
        compatibilityProfile="v1.19.29"
        saveStatus="pending"
        onBack={() => undefined}
      />,
    );

    expect(screen.getByText(t('statusBar.pending'))).toBeDefined();
    expect(screen.queryByText(t('statusBar.saved'))).toBeNull();
  });

  it('calls onBack when the back button is clicked — the only way off a selected project once the sidebar is hidden narrow (AppShell.tsx narrowFocus)', () => {
    const onBack = vi.fn();
    render(
      <StatusBar
        projectName="My Project"
        compatibilityProfile="v1.19.29"
        saveStatus="saved"
        onBack={onBack}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('statusBar.backButton') }));

    expect(onBack).toHaveBeenCalledOnce();
  });
});
