// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HashRouter, navigate, Routes, useRoutePath } from './router.js';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  window.location.hash = '';
});

const ROUTES = [
  { path: '/', element: <div>home</div> },
  { path: '/projects', element: <div>projects</div> },
];

describe('HashRouter / Routes', () => {
  it('renders the route matching the initial hash path', () => {
    window.location.hash = '#/projects';

    render(
      <HashRouter>
        <Routes routes={ROUTES} notFound={<div>missing</div>} />
      </HashRouter>,
    );

    expect(screen.getByText('projects')).toBeDefined();
    expect(screen.queryByText('home')).toBeNull();
  });

  it('defaults to "/" when there is no hash set', () => {
    render(
      <HashRouter>
        <Routes routes={ROUTES} notFound={<div>missing</div>} />
      </HashRouter>,
    );

    expect(screen.getByText('home')).toBeDefined();
  });

  it('treats a bare "#" with nothing after it the same as no hash', () => {
    window.location.hash = '#';

    render(
      <HashRouter>
        <Routes routes={ROUTES} notFound={<div>missing</div>} />
      </HashRouter>,
    );

    expect(screen.getByText('home')).toBeDefined();
  });

  it('renders notFound when no route matches the current path', () => {
    window.location.hash = '#/nope';

    render(
      <HashRouter>
        <Routes routes={ROUTES} notFound={<div>missing</div>} />
      </HashRouter>,
    );

    expect(screen.getByText('missing')).toBeDefined();
    expect(screen.queryByText('home')).toBeNull();
  });

  it('re-renders the matching route after navigate() changes the hash', async () => {
    render(
      <HashRouter>
        <Routes routes={ROUTES} notFound={<div>missing</div>} />
      </HashRouter>,
    );
    expect(screen.getByText('home')).toBeDefined();

    navigate('/projects');

    await waitFor(() => {
      expect(screen.getByText('projects')).toBeDefined();
    });
    expect(screen.queryByText('home')).toBeNull();
  });

  it('useRoutePath() throws when called outside a HashRouter', () => {
    function Probe(): null {
      useRoutePath();
      return null;
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<Probe />)).toThrow('useRoutePath() must be called within a <HashRouter>.');

    consoleError.mockRestore();
  });
});
