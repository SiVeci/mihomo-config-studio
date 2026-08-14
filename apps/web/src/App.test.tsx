// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App } from './App.js';
import { t } from './i18n/index.js';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  window.location.hash = '';
});

describe('App', () => {
  it('renders the home page title and tagline at the root path', () => {
    render(<App />);

    expect(screen.getByText(t('app.title'))).toBeDefined();
    expect(screen.getByText(t('app.tagline'))).toBeDefined();
  });

  it('renders the not-found page, including the unmatched path, for an unknown hash', () => {
    window.location.hash = '#/does-not-exist';

    render(<App />);

    expect(screen.getByText(t('app.notFoundPath', { path: '/does-not-exist' }))).toBeDefined();
  });
});
