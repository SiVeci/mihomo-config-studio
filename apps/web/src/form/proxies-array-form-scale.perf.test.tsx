// @vitest-environment jsdom
import { SchemaArrayForm } from '@mcs/form-renderer';
import { buildArrayFormPlan } from '@mcs/schema-core';
import { builtinAsStoredBundle, createRegistry } from '@mcs/schema-registry';
import { generateLargeCorpus } from '@mcs/test-fixtures';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  cleanup();
});

const CONTAINER_HEIGHT = 480;

/**
 * NFR-PERF-04 ("长列表必须虚拟化") for the `proxies` array-entry module —
 * discovered missing, not assumed: `e2e/long-task.spec.ts` (v0.9.0 #11)
 * measured a real 1.5s main-thread long task importing the exact 1 MB
 * corpus this test also uses, root-caused to `SchemaArrayForm` rendering
 * every one of its 3,182 proxies with a plain, unvirtualized `.map()`.
 * `RuleListPage`'s own scale test (`rule-list-scale.perf.test.tsx`) is the
 * template this mirrors — same assertion shape (DOM node count stays a
 * small slice of the real item count), different component.
 */
describe('SchemaArrayForm at real 1 MB corpus scale — 3,182 proxies (NFR-PERF-04)', () => {
  it('renders far fewer DOM entries than the real proxy count (virtualization is active at real v0.9.0 scale)', () => {
    const corpus = generateLargeCorpus();
    const parsed = MihomoYamlDocument.parse(corpus).document!;
    const value = parsed.toJS();
    const proxies = (value as { proxies: unknown[] }).proxies;
    expect(proxies.length).toBeGreaterThan(1000); // sanity: this really is the large-scale corpus

    const proxiesModule = createRegistry(builtinAsStoredBundle())
      .modules()
      .find((module) => module.manifest.id === 'proxies');
    expect(proxiesModule).toBeDefined();

    render(
      <SchemaArrayForm
        module={proxiesModule!}
        value={value}
        mode="basic"
        onChange={() => {}}
        containerHeight={CONTAINER_HEIGHT}
      />,
    );

    const rendered = document.querySelectorAll('[data-array-index]');
    expect(rendered.length).toBeLessThan(100);
    expect(rendered.length).toBeGreaterThan(0);
  }, 30_000);

  /**
   * v0.9.0 #11 virtualized the DOM but not the plan: `buildArrayFormPlan`
   * still ran its full per-entry `buildFormPlan` for all 3,182 entries every
   * render (root cause of the long task this whole describe block guards
   * against). v1.0.0 #2 fixes the planner itself — this asserts the fix at
   * the same real 1 MB scale, not just the smaller synthetic fixtures in
   * `form-plan.test.ts`: planning a small window costs a small plan,
   * regardless of how large the underlying collection actually is.
   */
  it('planned item count tracks the requested window, not the collection size, at real 1 MB corpus scale', () => {
    const corpus = generateLargeCorpus();
    const parsed = MihomoYamlDocument.parse(corpus).document!;
    const value = parsed.toJS();
    const proxies = (value as { proxies: unknown[] }).proxies;
    expect(proxies.length).toBeGreaterThan(1000);

    const proxiesModule = createRegistry(builtinAsStoredBundle())
      .modules()
      .find((module) => module.manifest.id === 'proxies')!;

    const windowed = buildArrayFormPlan(proxiesModule, value, {
      mode: 'basic',
      window: { start: 500, end: 513 },
    });
    expect(windowed).toHaveLength(13);
    expect(windowed.map((field) => field.path)).toEqual(
      Array.from({ length: 13 }, (_, offset) => ['proxies', 500 + offset]),
    );

    const unwindowed = buildArrayFormPlan(proxiesModule, value, { mode: 'basic' });
    expect(unwindowed).toHaveLength(proxies.length);
  }, 30_000);
});
