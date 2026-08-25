import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Self-built hash router, not react-router-dom: v0.2.0 only has 2-3 routes,
 * and a hash router avoiding server-side rewrite rules keeps a static
 * deployment simple. This is deliberately minimal — exact-path matching
 * only, no nested routes or params — matching the same "small and
 * self-contained beats a dependency for something this size" posture as
 * this app's own i18n module. v0.4.0 confirmed this still holds (E3): the
 * main column's 表单/规则/关系图 view switch (#7) is component-internal
 * `useState`, not a route — those views are cheap to swap and irrelevant to
 * browser history, so the route count this router handles did not grow.
 * Revisit if a future version actually needs deep-linkable/bookmarkable
 * views, not before.
 */

export interface Route {
  readonly path: string;
  readonly element: ReactNode;
}

function currentHashPath(): string {
  const hash = window.location.hash;
  return hash.startsWith('#') ? hash.slice(1) || '/' : '/';
}

/** Navigates to `path` by setting `location.hash`; triggers the `hashchange` listener below. */
export function navigate(path: string): void {
  window.location.hash = path;
}

const RouterContext = createContext<string | null>(null);

export function HashRouter({ children }: { children: ReactNode }): ReactNode {
  const [path, setPath] = useState(currentHashPath);

  useEffect(() => {
    const onHashChange = (): void => setPath(currentHashPath());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return <RouterContext.Provider value={path}>{children}</RouterContext.Provider>;
}

/** The current hash path (e.g. `/projects`), always starting with `/`. */
export function useRoutePath(): string {
  const path = useContext(RouterContext);
  if (path === null) {
    throw new Error('useRoutePath() must be called within a <HashRouter>.');
  }
  return path;
}

export interface RoutesProps {
  readonly routes: readonly Route[];
  readonly notFound: ReactNode;
}

/** Renders the element for the current path's exact match, or `notFound`. */
export function Routes({ routes, notFound }: RoutesProps): ReactNode {
  const path = useRoutePath();
  const match = useMemo(() => routes.find((route) => route.path === path), [routes, path]);
  return match ? match.element : notFound;
}
