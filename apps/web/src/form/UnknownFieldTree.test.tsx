// @vitest-environment jsdom
import type { PlannedField } from '@mcs/schema-core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n/index.js';
import type { TextRange } from '../worker/protocol.js';
import { UnknownFieldTree } from './UnknownFieldTree.js';
import type { UnknownFieldTreeWorkerClient } from './UnknownFieldTree.js';

afterEach(() => {
  cleanup();
});

function unknownField(overrides: Partial<PlannedField> = {}): PlannedField {
  return {
    key: 'mystery',
    path: ['dns', 'mystery'],
    control: 'unknown',
    schema: {},
    ui: {},
    value: 42,
    present: true,
    visible: true,
    required: false,
    readOnly: false,
    sensitive: false,
    deprecated: false,
    unknown: true,
    group: 'unknown',
    ...overrides,
  };
}

function fakeClient(range: TextRange | null = null): UnknownFieldTreeWorkerClient & {
  locate: ReturnType<typeof vi.fn>;
} {
  return {
    locate: vi.fn(async () => ({ type: 'locate' as const, requestId: 'x', range })),
  };
}

describe('UnknownFieldTree (FR-VAL-05 UI side, v0.3.0 #16)', () => {
  it('renders nothing when there are no unknown fields', () => {
    const { container } = render(
      <UnknownFieldTree fields={[]} client={fakeClient()} onJump={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows a collapsible summary with the count and every field’s pointer path', () => {
    render(
      <UnknownFieldTree
        fields={[unknownField(), unknownField({ path: ['proxies', 0, 'extra-flag'] })]}
        client={fakeClient()}
        onJump={vi.fn()}
      />,
    );

    expect(screen.getByText(`${t('unknownFields.title')} (2)`, { exact: false })).toBeDefined();
    expect(screen.getByText('/dns/mystery')).toBeDefined();
    expect(screen.getByText('/proxies/0/extra-flag')).toBeDefined();
  });

  it('shows the raw value for a primitive field, stringified for an object one', () => {
    render(
      <UnknownFieldTree
        fields={[
          unknownField({ path: ['a'], value: 42 }),
          unknownField({ path: ['b'], value: true }),
          unknownField({ path: ['c'], value: { nested: 'x' } }),
        ]}
        client={fakeClient()}
        onJump={vi.fn()}
      />,
    );

    expect(screen.getByText('42')).toBeDefined();
    expect(screen.getByText('true')).toBeDefined();
    expect(screen.getByText('{"nested":"x"}')).toBeDefined();
  });

  it('shows an empty value rather than the literal word "undefined" for a genuinely undefined value', () => {
    render(
      <UnknownFieldTree
        fields={[unknownField({ path: ['weird'], value: undefined })]}
        client={fakeClient()}
        onJump={vi.fn()}
      />,
    );

    const output = document.querySelector('.unknown-field-tree__value');
    expect(output?.textContent).toBe('');
  });

  it('shows no docs-search link when the field’s own key is not a nameable string (e.g. a bare array index)', () => {
    render(
      <UnknownFieldTree
        fields={[unknownField({ path: ['proxies', 0] })]}
        client={fakeClient()}
        onJump={vi.fn()}
      />,
    );

    expect(screen.getByText('/proxies/0')).toBeDefined();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('never renders any error-styled marker — unknown is not error (PRD §8.3/§12)', () => {
    const { container } = render(
      <UnknownFieldTree fields={[unknownField()]} client={fakeClient()} onJump={vi.fn()} />,
    );
    expect(container.querySelector('[class*="error"]')).toBeNull();
    expect(container.querySelector('[data-severity="error"]')).toBeNull();
  });

  describe('jump to YAML line', () => {
    it('resolves the range via client.locate(path) and calls onJump with it', async () => {
      const range: TextRange = {
        start: { offset: 10, line: 2, column: 1 },
        end: { offset: 14, line: 2, column: 5 },
      };
      const client = fakeClient(range);
      const onJump = vi.fn();
      render(<UnknownFieldTree fields={[unknownField()]} client={client} onJump={onJump} />);

      fireEvent.click(screen.getByRole('button', { name: t('unknownFields.jumpToLineButton') }));

      expect(client.locate).toHaveBeenCalledWith(['dns', 'mystery']);
      await waitFor(() => expect(onJump).toHaveBeenCalledWith(range));
    });

    it('does not call onJump when locate resolves a null range', async () => {
      const client = fakeClient(null);
      const onJump = vi.fn();
      render(<UnknownFieldTree fields={[unknownField()]} client={client} onJump={onJump} />);

      fireEvent.click(screen.getByRole('button', { name: t('unknownFields.jumpToLineButton') }));

      await waitFor(() => expect(client.locate).toHaveBeenCalled());
      expect(onJump).not.toHaveBeenCalled();
    });
  });

  describe('official-docs search link (NFR-SEC-01)', () => {
    it('is a plain link the browser opens, not a fetch this app makes', () => {
      render(<UnknownFieldTree fields={[unknownField()]} client={fakeClient()} onJump={vi.fn()} />);

      const link = screen.getByRole('link', { name: t('unknownFields.docsSearchLink') });
      expect(link.getAttribute('href')).toContain('https://');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noreferrer');
    });

    it('carries only the field’s own key in the query, never a value from the document', () => {
      render(
        <UnknownFieldTree
          fields={[unknownField({ path: ['dns', 'mystery'], value: 'super-secret-value' })]}
          client={fakeClient()}
          onJump={vi.fn()}
        />,
      );

      const href = screen
        .getByRole('link', { name: t('unknownFields.docsSearchLink') })
        .getAttribute('href')!;
      expect(href).toContain(encodeURIComponent('mystery'));
      expect(href).not.toContain('super-secret-value');
      expect(href).not.toContain(encodeURIComponent('super-secret-value'));
    });

    it('never carries the full path (which can itself embed array indices tied to real content), only the last segment', () => {
      render(
        <UnknownFieldTree
          fields={[unknownField({ path: ['proxies', 3, 'extra-flag'] })]}
          client={fakeClient()}
          onJump={vi.fn()}
        />,
      );

      const href = screen
        .getByRole('link', { name: t('unknownFields.docsSearchLink') })
        .getAttribute('href')!;
      expect(href).toContain(encodeURIComponent('extra-flag'));
      expect(decodeURIComponent(href)).not.toContain('proxies/3');
    });
  });
});
