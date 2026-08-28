import { useEffect, useState } from 'react';
import { BREAKPOINTS } from '@mcs/ui';

const NARROW_QUERY = `(max-width: ${BREAKPOINTS.tablet.value})`;

function matchesNarrow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(NARROW_QUERY).matches;
}

/**
 * Same breakpoint `AppShell.tsx`'s `RESPONSIVE_STYLE` uses for the
 * CSS-only narrow-screen layout — this hook exists for the one place CSS
 * visibility is not enough: `ProjectPage`'s "问题" mobile page duplicates
 * the desktop aside's `IssuePanel`/`UnknownFieldTree` (both cheap,
 * props-only components, see that duplication's own comment) rather than
 * relocating them, and duplicated content must not actually be *mounted*
 * twice, or `getByRole`/`getByText` queries — in tests, and any real
 * assistive tech that does not honor `display: none` the way visual
 * rendering does — find two matches instead of one. Gating that one
 * duplicate's mount on this hook keeps it out of the tree entirely on a
 * wide screen. `window.matchMedia` is absent under plain jsdom (no test
 * mocks it), so this defaults to `false` (desktop) there, same as every
 * existing test already assumed before this hook existed.
 */
export function useNarrowViewport(): boolean {
  const [isNarrow, setIsNarrow] = useState(matchesNarrow);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(NARROW_QUERY);
    function handleChange(): void {
      setIsNarrow(query.matches);
    }
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  return isNarrow;
}
