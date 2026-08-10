// @vitest-environment jsdom
import type { SchemaModule } from '@mcs/schema-core';
import { sampleModule } from '@mcs/schema-core/testing';
import type { ConfigPath } from '@mcs/yaml-engine';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchemaForm } from './index.js';

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
