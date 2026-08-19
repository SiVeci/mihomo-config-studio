// @vitest-environment jsdom
import type { SchemaModule } from '@mcs/schema-core';
import { sampleModule } from '@mcs/schema-core/testing';
import type { ConfigPath } from '@mcs/yaml-engine';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchemaArrayForm, SchemaForm } from './index.js';

afterEach(cleanup);

const DOCUMENT = {
  sample: {
    mode: 'rule',
    'log-level': 'info',
    'allow-lan': false,
    'mixed-port': 7890,
    secret: 'super-secret-token',
    hosts: { 'a.example.com': '127.0.0.1' },
    'skip-domain': ['Mijia Cloud'],
    tun: { enable: true, stack: 'mixed' },
  },
};

function renderForm(overrides: Partial<Parameters<typeof SchemaForm>[0]> = {}) {
  const onChange = vi.fn<(path: ConfigPath, value: unknown) => void>();
  render(
    <SchemaForm
      module={sampleModule}
      value={DOCUMENT}
      mode="advanced"
      onChange={onChange}
      {...overrides}
    />,
  );
  return onChange;
}

const fieldNode = (path: string) => document.querySelector(`[data-field="${path}"]`);

describe('SchemaForm (FR-SCHEMA-01, FR-SCHEMA-05)', () => {
  it('renders a control per planned field, chosen from the schema', () => {
    renderForm();

    expect(fieldNode('/sample/mode')?.getAttribute('data-control')).toBe('select');
    expect(fieldNode('/sample/allow-lan')?.getAttribute('data-control')).toBe('switch');
    expect(fieldNode('/sample/mixed-port')?.getAttribute('data-control')).toBe('port');
    expect(fieldNode('/sample/hosts')?.getAttribute('data-control')).toBe('key-value');
    expect(fieldNode('/sample/skip-domain')?.getAttribute('data-control')).toBe('tags');
  });

  it('reports edits as (path, value) pairs the YAML engine can apply', () => {
    const onChange = renderForm();

    fireEvent.change(screen.getByLabelText(/field.mode/), { target: { value: 'global' } });
    expect(onChange).toHaveBeenCalledWith(['sample', 'mode'], 'global');

    fireEvent.click(screen.getByRole('switch', { name: /allow-lan/ }));
    expect(onChange).toHaveBeenCalledWith(['sample', 'allow-lan'], true);

    fireEvent.change(screen.getByLabelText('mixed-port'), { target: { value: '7891' } });
    expect(onChange).toHaveBeenCalledWith(['sample', 'mixed-port'], 7891);
  });

  it('masks a sensitive value until the user reveals it (NFR-SEC-02)', () => {
    renderForm();
    const input = screen.getByLabelText('secret') as HTMLInputElement;

    expect(input.type).toBe('password');
    expect(fieldNode('/sample/secret')?.getAttribute('data-sensitive')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'field.reveal' }));
    expect((screen.getByLabelText('secret') as HTMLInputElement).type).toBe('text');
  });

  it('honours visibleWhen without unmounting the underlying value', () => {
    renderForm();
    expect(fieldNode('/sample/bind-address')).toBeNull();

    cleanup();
    renderForm({ value: { sample: { ...DOCUMENT.sample, 'allow-lan': true } } });
    expect(fieldNode('/sample/bind-address')).not.toBeNull();
  });

  it('hides advanced fields in basic mode', () => {
    renderForm({ mode: 'basic' });
    expect(fieldNode('/sample/tun')).toBeNull();
    expect(fieldNode('/sample/mode')).not.toBeNull();
  });

  it('renders nested object children with their own controls', () => {
    renderForm();
    expect(fieldNode('/sample/tun/enable')?.getAttribute('data-control')).toBe('switch');
    expect(fieldNode('/sample/tun/stack')?.getAttribute('data-control')).toBe('select');
  });

  it('labels every control and marks required fields non-visually (NFR-A11Y)', () => {
    renderForm({ value: { sample: { ...DOCUMENT.sample, 'allow-lan': true } } });

    // getByLabelText throws if the control has no accessible name.
    expect(screen.getByLabelText(/field.mode/)).toBeDefined();
    const required = fieldNode('/sample/bind-address')?.querySelector('abbr');
    expect(required?.getAttribute('title')).toBe('required');
  });

  it('surfaces an unknown field read-only instead of dropping it (FR-YAML-02)', () => {
    renderForm({ value: { sample: { mode: 'rule', 'brand-new-flag': 42 } } });

    const node = fieldNode('/sample/brand-new-flag');
    expect(node?.getAttribute('data-unknown')).toBe('true');
    expect(node?.textContent).toContain('42');
  });
});

describe('non-colour badges (NFR-A11Y, v0.3.0 #14)', () => {
  const BADGE_MODULE: SchemaModule = {
    manifest: { id: 'badges', root: ['badges'], version: '1.0.0' },
    schema: {
      type: 'object',
      properties: {
        old: { type: 'string', deprecated: true },
        beta: { type: 'string' },
        risky: { type: 'string' },
      },
    },
    ui: { fields: { beta: { experimental: true }, risky: { safety: 'dangerous' } } },
  };

  function translate(key: string): string {
    return key === 'badge.deprecated'
      ? '已废弃'
      : key === 'badge.experimental'
        ? '实验性'
        : key === 'badge.danger'
          ? '需谨慎'
          : key;
  }

  it('renders real translated text for each badge, not just the data-badge attribute', () => {
    render(
      <SchemaForm
        module={BADGE_MODULE}
        value={{ badges: { old: 'x', beta: 'y', risky: 'z' } }}
        mode="advanced"
        onChange={vi.fn()}
        t={translate}
      />,
    );

    expect(document.querySelector('[data-badge="deprecated"]')?.textContent).toBe('已废弃');
    expect(document.querySelector('[data-badge="experimental"]')?.textContent).toBe('实验性');
    expect(document.querySelector('[data-badge="danger"]')?.textContent).toBe('需谨慎');
  });

  it('renders real translated text for the official-docs link too, not the raw i18n key', () => {
    const docsModule: SchemaModule = {
      manifest: { id: 'docs', root: ['docs'], version: '1.0.0' },
      schema: { type: 'object', properties: { field: { type: 'string' } } },
      ui: { fields: { field: { docs: 'https://example.com/docs' } } },
    };
    function translateDocs(key: string): string {
      return key === 'link.officialDocs' ? '查看官方文档' : key;
    }

    render(
      <SchemaForm
        module={docsModule}
        value={{ docs: { field: 'x' } }}
        mode="advanced"
        onChange={vi.fn()}
        t={translateDocs}
      />,
    );

    const link = fieldNode('/docs/field')?.querySelector('a[href="https://example.com/docs"]');
    expect(link?.textContent).toBe('查看官方文档');
  });
});

describe('schema-only extension end to end (FR-SCHEMA-06)', () => {
  it('renders a field added by a bundle update with no renderer change', () => {
    const updated: SchemaModule = {
      ...sampleModule,
      schema: {
        ...sampleModule.schema,
        properties: {
          ...sampleModule.schema.properties,
          'unified-delay': { type: 'boolean', default: false },
          'external-ui': { type: 'string' },
        },
      },
    };

    const onChange = renderForm({ module: updated });

    expect(fieldNode('/sample/unified-delay')?.getAttribute('data-control')).toBe('switch');
    expect(fieldNode('/sample/external-ui')?.getAttribute('data-control')).toBe('text');

    fireEvent.click(screen.getByRole('switch', { name: 'unified-delay' }));
    expect(onChange).toHaveBeenCalledWith(['sample', 'unified-delay'], true);
  });
});

// Deliberately Mihomo-unrelated branch names ("a"/"b", not "vmess"/"trojan"):
// the renderer must work from `field.variant`, produced entirely from the
// schema's own const/enum branches, not from recognising a protocol name
// (FR-SCHEMA-06 applied to unions).
const VARIANT_MODULE: SchemaModule = {
  manifest: { id: 'variant-sample', root: ['sample'], version: '1.0.0' },
  schema: {
    type: 'object',
    properties: {
      transport: { oneOf: [{ $ref: '#/$defs/kindA' }, { $ref: '#/$defs/kindB' }] },
    },
    $defs: {
      shared: { type: 'object', properties: { note: { type: 'string' } } },
      kindA: {
        allOf: [
          { $ref: '#/$defs/shared' },
          { type: 'object', properties: { kind: { const: 'a' }, x: { type: 'string' } } },
        ],
      },
      kindB: {
        allOf: [
          { $ref: '#/$defs/shared' },
          { type: 'object', properties: { kind: { const: 'b' }, y: { type: 'string' } } },
        ],
      },
    },
  },
  ui: {
    fields: {
      transport: {
        label: 'field.transport',
        variantLabels: { a: 'variant.kindA', b: 'variant.kindB' },
      },
    },
  },
};

const VARIANT_DOCUMENT = {
  sample: { transport: { kind: 'a', note: 'shared-value', x: 'hello', extra: 'unlisted' } },
};

describe('variant control (FR-SCHEMA-02 rendering, E4)', () => {
  function renderVariant(overrides: Partial<Parameters<typeof SchemaForm>[0]> = {}) {
    const onChange = vi.fn<(path: ConfigPath, value: unknown) => void>();
    render(
      <SchemaForm
        module={VARIANT_MODULE}
        value={VARIANT_DOCUMENT}
        mode="advanced"
        onChange={onChange}
        {...overrides}
      />,
    );
    return onChange;
  }

  function variantSelect(): HTMLSelectElement {
    const select = fieldNode('/sample/transport')?.querySelector('select[data-control="variant"]');
    if (!select) throw new Error('variant select not rendered');
    return select as HTMLSelectElement;
  }

  it('renders a discriminator select with schema-derived options and labels', () => {
    renderVariant();
    const select = variantSelect();
    expect([...select.options].map((option) => option.value)).toEqual(['a', 'b']);
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'variant.kindA',
      'variant.kindB',
    ]);
    expect(select.value).toBe('a');
  });

  it('reports switching the discriminator as one onChange to the discriminator path, not the field path', () => {
    const onChange = renderVariant();
    fireEvent.change(variantSelect(), { target: { value: 'b' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['sample', 'transport', 'kind'], 'b');
  });

  it("renders the matched branch's own fields, not the other branch's", () => {
    renderVariant();
    expect(fieldNode('/sample/transport/x')).not.toBeNull();
    expect(fieldNode('/sample/transport/y')).toBeNull();
    // Shared (via $defs/allOf) fields still render as ordinary children.
    expect(fieldNode('/sample/transport/note')).not.toBeNull();
    // The discriminator itself is the select above, not a duplicated child row.
    expect(fieldNode('/sample/transport/kind')).toBeNull();
  });

  it('surfaces a property the matched branch does not declare as an unknown row instead of dropping it (E4)', () => {
    renderVariant();
    const node = fieldNode('/sample/transport/extra');
    expect(node?.getAttribute('data-unknown')).toBe('true');
    expect(node?.textContent).toContain('unlisted');
  });

  it('uses a labelled group instead of a dangling label (NFR-A11Y)', () => {
    renderVariant();
    const field = fieldNode('/sample/transport');
    // The transport field itself must not get a `<label for>` — only its
    // plain-text children (which are genuinely labelable) legitimately do.
    expect(field?.querySelector('label[for="/sample/transport"]')).toBeNull();

    const group = field?.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    const labelledBy = group?.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy ?? '')?.textContent).toContain('field.transport');
  });

  it('marks an unrecognised discriminator value with non-colour text feedback instead of guessing a branch', () => {
    renderVariant({ value: { sample: { transport: { kind: 'c', mystery: true } } } });

    const select = variantSelect();
    expect(select.value).toBe('c'); // kept visible/selectable, not silently coerced
    expect(fieldNode('/sample/transport')?.textContent).toContain('field.variant.unmatched');
    // No branch matched, so no children are planned — the raw value is not
    // decomposed into editable rows, but it is not lost either (see #0).
    expect(fieldNode('/sample/transport/mystery')).toBeNull();
  });
});

// Two modules sharing a document root (`general`/`inbound`'s real shape),
// mirroring `form-plan.test.ts`'s own fixture for the same scenario.
const ALPHA_MODULE: SchemaModule = {
  manifest: { id: 'alpha', root: [], version: '1.0.0' },
  schema: { type: 'object', properties: { foo: { type: 'string' } } },
  ui: {},
};

describe('SchemaForm additionalKnownPaths (FR-VAL-05, v0.3.0 #14)', () => {
  it('without it, a sibling module’s own field renders as an unknown row', () => {
    render(
      <SchemaForm
        module={ALPHA_MODULE}
        value={{ foo: 'x', bar: 'y' }}
        mode="advanced"
        onChange={vi.fn()}
      />,
    );
    expect(fieldNode('/bar')?.getAttribute('data-unknown')).toBe('true');
  });

  it('passing the sibling’s path in suppresses the unknown row entirely', () => {
    render(
      <SchemaForm
        module={ALPHA_MODULE}
        value={{ foo: 'x', bar: 'y' }}
        mode="advanced"
        onChange={vi.fn()}
        additionalKnownPaths={new Set([JSON.stringify(['bar'])])}
      />,
    );
    expect(fieldNode('/bar')).toBeNull();
    expect(fieldNode('/foo')?.getAttribute('data-unknown')).toBeNull();
  });
});

// A discriminated-union-of-array-elements module (`proxies`'/`proxy-providers`'
// real shape), mirroring `form-plan.test.ts`'s own fixture for the same
// scenario: the schema's own root is `oneOf`, `manifest.root` addresses an
// array in the document.
const ARRAY_MODULE: SchemaModule = {
  manifest: { id: 'items', root: ['items'], version: '1.0.0' },
  schema: {
    $defs: {
      shared: { type: 'object', properties: { label: { type: 'string' } } },
      a: {
        allOf: [
          { $ref: '#/$defs/shared' },
          { type: 'object', properties: { kind: { const: 'a' }, onlyA: { type: 'string' } } },
        ],
      },
      b: {
        allOf: [
          { $ref: '#/$defs/shared' },
          { type: 'object', properties: { kind: { const: 'b' }, onlyB: { type: 'string' } } },
        ],
      },
    },
    oneOf: [{ $ref: '#/$defs/a' }, { $ref: '#/$defs/b' }],
  },
  ui: { fields: { kind: { variantLabels: { a: 'variant.a', b: 'variant.b' } } } },
};

describe('SchemaArrayForm (FR-SCHEMA-01, v0.3.0 #14)', () => {
  function renderArrayForm(overrides: Partial<Parameters<typeof SchemaArrayForm>[0]> = {}) {
    const onChange = vi.fn<(path: ConfigPath, value: unknown) => void>();
    render(
      <SchemaArrayForm
        module={ARRAY_MODULE}
        value={{
          items: [
            { kind: 'a', label: 'first', onlyA: 'x' },
            { kind: 'b', label: 'second', onlyB: 'y' },
          ],
        }}
        mode="advanced"
        onChange={onChange}
        {...overrides}
      />,
    );
    return onChange;
  }

  it('renders one discriminator select per array element, addressed by its own index', () => {
    renderArrayForm();
    expect(document.querySelectorAll('[data-array-index]')).toHaveLength(2);
    expect(fieldNode('/items/0')?.querySelector('select[data-control="variant"]')).not.toBeNull();
    expect(fieldNode('/items/1')?.querySelector('select[data-control="variant"]')).not.toBeNull();
  });

  it('each element renders its own matched branch fields, correctly addressed', () => {
    renderArrayForm();
    expect(fieldNode('/items/0/onlyA')).not.toBeNull();
    expect(fieldNode('/items/0/onlyB')).toBeNull();
    expect(fieldNode('/items/1/onlyB')).not.toBeNull();
    expect(fieldNode('/items/1/onlyA')).toBeNull();
  });

  it('editing one element’s discriminator reports the change at that element’s own path, not another’s', () => {
    const onChange = renderArrayForm();
    const secondSelect = fieldNode('/items/1')?.querySelector(
      'select[data-control="variant"]',
    ) as HTMLSelectElement;

    fireEvent.change(secondSelect, { target: { value: 'a' } });

    expect(onChange).toHaveBeenCalledWith(['items', 1, 'kind'], 'a');
  });

  it('renders nothing when the module’s root is absent, without throwing', () => {
    expect(() => renderArrayForm({ value: {} })).not.toThrow();
    expect(document.querySelectorAll('[data-array-index]')).toHaveLength(0);
  });
});
