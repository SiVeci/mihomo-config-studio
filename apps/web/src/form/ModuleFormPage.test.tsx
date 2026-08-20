// @vitest-environment jsdom
import {
  DNS_MODULE,
  GENERAL_MODULE,
  INBOUND_MODULE,
  PROXIES_MODULE,
  PROXY_PROVIDERS_MODULE,
} from '@mcs/schema-builtin';
import type { ConfigPath } from '@mcs/yaml-engine';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setLocale, t } from '../i18n/index.js';
import { ModuleFormPage } from './ModuleFormPage.js';
import type { ModuleFormPageHandle } from './ModuleFormPage.js';

const GENERAL_MODE_LABEL = GENERAL_MODULE.i18n?.['zh-CN']?.['field.mode'];
if (!GENERAL_MODE_LABEL) throw new Error('GENERAL_MODULE has no zh-CN field.mode label');

// jsdom does not implement `scrollIntoView` at all (real browsers do) — a
// test-environment gap `jumpToField` below runs into, not something
// production code needs to guard against.
Element.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
  setLocale('zh-CN');
});

// `general`/`inbound` really do share a document root (`root: []`) — this is
// the exact structural situation v0.3.0 #8 deferred and #14 must resolve.
const DOCUMENT = {
  mode: 'rule',
  'log-level': 'info',
  'allow-lan': false,
  port: 7890,
  'mixed-port': 7891,
  proxies: [
    { name: 'a', type: 'http', server: 'example.com', port: 443 },
    { name: 'b', type: 'trojan', server: 'example.org', port: 443, password: 'hunter2' },
  ],
};

function renderPage(overrides: Partial<Parameters<typeof ModuleFormPage>[0]> = {}) {
  const onModeChange = vi.fn();
  const onFieldChange = vi.fn<(path: ConfigPath, value: unknown) => void>();
  render(
    <ModuleFormPage
      modules={[GENERAL_MODULE, INBOUND_MODULE, PROXIES_MODULE]}
      value={DOCUMENT}
      mode="advanced"
      onModeChange={onModeChange}
      onFieldChange={onFieldChange}
      {...overrides}
    />,
  );
  return { onModeChange, onFieldChange };
}

describe('ModuleFormPage (FR-SCHEMA-01, PRD §7.4, v0.3.0 #14)', () => {
  it('renders one section per resolved module, identified by its manifest id', () => {
    renderPage();
    expect(document.querySelector('[data-module-section="general"]')).not.toBeNull();
    expect(document.querySelector('[data-module-section="inbound"]')).not.toBeNull();
    expect(document.querySelector('[data-module-section="proxies"]')).not.toBeNull();
  });

  it('shows the empty state and renders no sections when no modules are resolved', () => {
    renderPage({ modules: [] });
    expect(document.querySelectorAll('[data-module-section]')).toHaveLength(0);
  });

  it('shows the empty state and renders no sections when the document value is not yet known (value: null)', () => {
    // Distinct from an empty-but-real document ({}), which must still render
    // every field at its schema default — only `null` (not yet loaded, or a
    // syntax-broken parse per protocol.ts's handleParse) means "nothing to
    // plan yet" (v0.3.0 #14).
    renderPage({ value: null });
    expect(document.querySelectorAll('[data-module-section]')).toHaveLength(0);
  });

  it('renders every field at its schema default for a real, merely empty document ({})', () => {
    renderPage({ value: {} });
    expect(document.querySelector('[data-module-section="general"]')).not.toBeNull();
  });

  it('general and inbound do not flag each other’s real fields as unknown (shared root, v0.3.0 #8/#14)', () => {
    renderPage();

    const generalSection = document.querySelector('[data-module-section="general"]')!;
    const inboundSection = document.querySelector('[data-module-section="inbound"]')!;

    // `port` belongs to inbound; general's own section must not claim it as unknown.
    expect(generalSection.querySelector('[data-field="/port"]')).toBeNull();
    // `mode` belongs to general; inbound's own section must not claim it as unknown.
    expect(inboundSection.querySelector('[data-field="/mode"]')).toBeNull();
    // Each module still renders its own real fields, not suppressed entirely.
    expect(
      generalSection.querySelector('[data-field="/mode"]')?.getAttribute('data-unknown'),
    ).not.toBe('true');
    expect(
      inboundSection.querySelector('[data-field="/port"]')?.getAttribute('data-unknown'),
    ).not.toBe('true');
  });

  it('general does not flag a sibling module’s own root key — proxies — as an unknown field of its own (regression: real bug shipped in #14, found while building #16)', () => {
    // `general`'s root is `[]` (the whole document), so its own "extra key"
    // walk previously saw `proxies` (a real top-level Mihomo section, owned
    // by the separately-rooted PROXIES_MODULE) with nowhere recorded that
    // marked `['proxies']` itself as claimed — `computeKnownPaths` only ever
    // recorded a module's own *declared child* paths, never its own bare
    // `manifest.root`. `dns`/`sniffer` have the identical shape (`root:
    // ['dns']`/`['sniffer']`) and were equally affected; `proxies` is the
    // one already present in this file's real fixture document.
    renderPage();
    const generalSection = document.querySelector('[data-module-section="general"]')!;
    expect(generalSection.querySelector('[data-field="/proxies"]')).toBeNull();
  });

  it('renders proxies as an array form, one entry per element, correctly addressed', () => {
    renderPage();
    const proxiesSection = document.querySelector('[data-module-section="proxies"]')!;
    expect(proxiesSection.querySelectorAll('[data-array-index]')).toHaveLength(2);
    expect(proxiesSection.querySelector('[data-field="/proxies/0"]')).not.toBeNull();
    expect(proxiesSection.querySelector('[data-field="/proxies/1"]')).not.toBeNull();
  });

  it('an edit inside a real field reports an absolute path ready for the Worker', () => {
    const { onFieldChange } = renderPage();

    fireEvent.change(screen.getByLabelText(GENERAL_MODE_LABEL), { target: { value: 'global' } });

    expect(onFieldChange).toHaveBeenCalledWith(['mode'], 'global');
  });

  it('the mode toggle reports onModeChange and never onFieldChange (exit condition 6: mode never writes)', () => {
    const { onModeChange, onFieldChange } = renderPage({ mode: 'basic' });

    fireEvent.change(screen.getByLabelText(t('form.modeLabel')), { target: { value: 'advanced' } });

    expect(onModeChange).toHaveBeenCalledWith('advanced');
    expect(onFieldChange).not.toHaveBeenCalled();
  });

  it('hides advanced-only fields in basic mode without unmounting their value (exit condition 6)', () => {
    renderPage({ mode: 'basic' });
    // inbound's `tun.enable` is UI-marked `advanced: true`.
    expect(document.querySelector('[data-field="/tun/enable"]')).toBeNull();

    cleanup();
    renderPage({ mode: 'advanced' });
    expect(document.querySelector('[data-field="/tun/enable"]')).not.toBeNull();
  });

  it('masks a real sensitive proxy field (a protocol password) by default (NFR-SEC-02)', () => {
    renderPage();
    const passwordInput = document.querySelector(
      '[data-field="/proxies/1/password"] input',
    ) as HTMLInputElement | null;
    expect(passwordInput?.type).toBe('password');
  });
});

describe('ModuleFormPage / proxy-providers (v0.3.0 #17)', () => {
  // Upstream's real shape (confirmed against the vendored comprehensive
  // sample): `proxy-providers:` is a YAML *map* keyed by provider name, not
  // a list — unlike `proxies`. Regression: #14 built `buildArrayFormPlan`
  // (via `isArrayEntryModule`, which cannot distinguish list from map at the
  // schema level, both being a bare `oneOf`) only ever exercised against the
  // list-shaped `proxies`, so a map document silently planned to nothing —
  // no error, just an empty section — until #17 fixed `buildArrayFormPlan`
  // itself and, for the first time, actually rendered this module here.
  const DOCUMENT_WITH_PROVIDERS = {
    'proxy-providers': {
      'provider-a': {
        type: 'http',
        url: 'https://example.com/subscribe?token=abc123',
        interval: 3600,
      },
    },
  };

  it('renders one entry per map key, addressed by its real provider name (not silently empty)', () => {
    render(
      <ModuleFormPage
        modules={[PROXY_PROVIDERS_MODULE]}
        value={DOCUMENT_WITH_PROVIDERS}
        mode="advanced"
        onModeChange={vi.fn()}
        onFieldChange={vi.fn()}
      />,
    );
    const section = document.querySelector('[data-module-section="proxy-providers"]')!;
    expect(section.querySelectorAll('[data-array-index]')).toHaveLength(1);
    expect(section.querySelector('[data-field="/proxy-providers/provider-a"]')).not.toBeNull();
  });

  it('renders the subscription url through SubscriptionField — masked input plus an independent copy action — not the generic secret control', () => {
    render(
      <ModuleFormPage
        modules={[PROXY_PROVIDERS_MODULE]}
        value={DOCUMENT_WITH_PROVIDERS}
        mode="advanced"
        onModeChange={vi.fn()}
        onFieldChange={vi.fn()}
      />,
    );
    const urlField = document.querySelector('[data-field="/proxy-providers/provider-a/url"]')!;
    expect(urlField.getAttribute('data-control')).toBe('subscription-url');
    const input = urlField.querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(screen.getByRole('button', { name: t('field.copy') })).toBeDefined();
  });
});

describe('ModuleFormPage.jumpToField (FR-VAL-02, v0.3.0 #16)', () => {
  it('scrolls to and focuses a real field’s own control', () => {
    const ref = createRef<ModuleFormPageHandle>();
    const onModeChange = vi.fn();
    const onFieldChange = vi.fn<(path: ConfigPath, value: unknown) => void>();
    render(
      <ModuleFormPage
        ref={ref}
        modules={[GENERAL_MODULE, INBOUND_MODULE, PROXIES_MODULE]}
        value={DOCUMENT}
        mode="advanced"
        onModeChange={onModeChange}
        onFieldChange={onFieldChange}
      />,
    );

    ref.current!.jumpToField(['mode']);

    const modeControl = document.getElementById('/mode');
    expect(document.activeElement).toBe(modeControl);
  });

  it('focuses the field’s own row (via a temporary tabindex) when it has no focusable control — an unknown field, rendered read-only (regression: real bug, .focus() on a plain <div> is a silent no-op, caught manually in a real browser)', () => {
    const ref = createRef<ModuleFormPageHandle>();
    render(
      <ModuleFormPage
        ref={ref}
        modules={[DNS_MODULE]}
        value={{ dns: { enable: true, 'totally-made-up-field': 'hello' } }}
        mode="advanced"
        onModeChange={vi.fn()}
        onFieldChange={vi.fn()}
      />,
    );

    ref.current!.jumpToField(['dns', 'totally-made-up-field']);

    const row = document.querySelector('[data-field="/dns/totally-made-up-field"]');
    expect(row?.getAttribute('data-control')).toBe('unknown');
    expect(document.activeElement).toBe(row);
    expect(row?.getAttribute('tabindex')).toBe('-1');
  });

  it('is a no-op, not a crash, when the path does not match any rendered field', () => {
    const ref = createRef<ModuleFormPageHandle>();
    render(
      <ModuleFormPage
        ref={ref}
        modules={[GENERAL_MODULE]}
        value={DOCUMENT}
        mode="advanced"
        onModeChange={vi.fn()}
        onFieldChange={vi.fn()}
      />,
    );
    const previouslyFocused = document.activeElement;

    expect(() => ref.current!.jumpToField(['does', 'not', 'exist'])).not.toThrow();
    expect(document.activeElement).toBe(previouslyFocused);
  });
});
