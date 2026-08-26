import { BUILTIN_TEMPLATES } from '@mcs/templates';
import { describe, expect, it } from 'vitest';

/**
 * `main()` (`index.ts`) iterates `BUILTIN_TEMPLATES` directly — no separate
 * list to keep in sync, so the runner can never "forget" a template the way
 * a hand-maintained matrix could. The risk this guards against is the
 * opposite direction: `@mcs/templates` growing a template in the future
 * without whoever adds it realising it also joins this kernel-test matrix
 * (a real cost — CI downloads a real kernel binary and runs `-t -f` against
 * every one of them). Pinning the exact count here is a deliberate
 * checkpoint a future template addition has to consciously update, not a
 * duplicate of `@mcs/templates`' own "ships all five" test (that one is
 * about template completeness; this one is about kernel-matrix membership),
 * v0.4.0 #17.
 */
describe('BUILTIN_TEMPLATES feeding the kernel test matrix (PRD §13.3/§13.5, v0.4.0 #17)', () => {
  it('covers all five PRD §8.8 MVP templates', () => {
    expect(BUILTIN_TEMPLATES.map((template) => template.id)).toEqual([
      'basic-proxy',
      'provider-auto-select',
      'home-router',
      'rule-set-routing',
      'android-target',
    ]);
  });
});
