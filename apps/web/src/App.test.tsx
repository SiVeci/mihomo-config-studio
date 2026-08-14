// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// App.tsx builds a real IndexedDbStorageAdapter for ProjectPage, which throws
// without a browser indexedDB; ProjectPage itself gets thorough, isolated
// coverage in ProjectPage.test.tsx with an injected MemoryStorageAdapter.
// This file's job is routing, not page content, so both are stubbed out.
vi.mock('@mcs/storage', () => ({
  IndexedDbStorageAdapter: class {},
}));
vi.mock('./project/ProjectPage.js', () => ({
  ProjectPage: () => <p>project-page-stub</p>,
}));

import { App } from './App.js';
import { t } from './i18n/index.js';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  window.location.hash = '';
});

describe('App', () => {
  it('renders the project page at the root path', () => {
    render(<App />);

    expect(screen.getByText('project-page-stub')).toBeDefined();
  });

  it('renders the not-found page, including the unmatched path, for an unknown hash', () => {
    window.location.hash = '#/does-not-exist';

    render(<App />);

    expect(screen.getByText(t('app.notFoundPath', { path: '/does-not-exist' }))).toBeDefined();
  });
});
