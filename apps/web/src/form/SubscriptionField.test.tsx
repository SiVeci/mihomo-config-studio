// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PlannedField } from '@mcs/schema-core';
import type { ConfigPath } from '@mcs/yaml-engine';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n/index.js';
import { SubscriptionField } from './SubscriptionField.js';

const URL_VALUE = 'https://example.com/subscribe?token=super-secret-token';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, 'clipboard');
});

function field(overrides: Partial<PlannedField> = {}): PlannedField {
  return {
    key: 'url',
    path: ['proxy-providers', 'provider-a', 'url'],
    control: 'subscription-url',
    schema: { type: 'string' },
    ui: {},
    value: URL_VALUE,
    present: true,
    visible: true,
    required: false,
    readOnly: false,
    sensitive: true,
    deprecated: false,
    unknown: false,
    group: 'source',
    ...overrides,
  };
}

function renderField(overrides: Partial<PlannedField> = {}) {
  const onChange = vi.fn<(path: ConfigPath, value: unknown) => void>();
  render(
    <SubscriptionField
      field={field(overrides)}
      id="url-input"
      onChange={onChange}
      translate={(key) => key}
    />,
  );
  return onChange;
}

function mockClipboard(): { writeText: ReturnType<typeof vi.fn> } {
  const clipboard = { writeText: vi.fn(async () => undefined) };
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  return clipboard;
}

/** Real, observed behaviour (not hypothetical): a permissions-policy restriction rejects `writeText` even though `navigator.clipboard` itself exists. */
function mockRejectingClipboard(): { writeText: ReturnType<typeof vi.fn> } {
  const clipboard = { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) };
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  return clipboard;
}

describe('SubscriptionField (FR-VAL-02-adjacent, NFR-SEC-02, PRD §8.11, v0.3.0 #17)', () => {
  it('masks the value by default, as a real password input', () => {
    renderField();
    const input = document.getElementById('url-input') as HTMLInputElement;
    expect(input.type).toBe('password');
  });

  it('reveals on an explicit click, and hides again on a second click', () => {
    renderField();
    const input = document.getElementById('url-input') as HTMLInputElement;
    expect(input.type).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: t('field.reveal') }));
    expect(input.type).toBe('text');

    fireEvent.click(screen.getByRole('button', { name: t('field.hide') }));
    expect(input.type).toBe('password');
  });

  it('renders an empty input rather than the literal word "null" when the field has no value yet', () => {
    renderField({ value: null });
    const input = document.getElementById('url-input') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('never renders the value as plain text outside the input, masked or revealed', () => {
    renderField();
    expect(screen.queryByText(URL_VALUE)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: t('field.reveal') }));
    expect(screen.queryByText(URL_VALUE)).toBeNull();
  });

  it('shows the ADR-005 notice that this app never fetches the URL itself', () => {
    renderField();
    expect(screen.getByText(t('form.subscriptionUrl.notice'))).toBeDefined();
  });

  it('reports an edit as (path, value), same shape as every other control', () => {
    const onChange = renderField();
    fireEvent.change(document.getElementById('url-input')!, {
      target: { value: 'https://example.com/new' },
    });
    expect(onChange).toHaveBeenCalledWith(
      ['proxy-providers', 'provider-a', 'url'],
      'https://example.com/new',
    );
  });

  describe('copy (independent of reveal)', () => {
    it('copies the real value without first revealing it', async () => {
      const clipboard = mockClipboard();
      renderField();
      const input = document.getElementById('url-input') as HTMLInputElement;

      fireEvent.click(screen.getByRole('button', { name: t('field.copy') }));

      expect(clipboard.writeText).toHaveBeenCalledWith(URL_VALUE);
      expect(input.type).toBe('password');
    });

    it('shows a transient confirmation after copying', async () => {
      mockClipboard();
      renderField();

      fireEvent.click(screen.getByRole('button', { name: t('field.copy') }));

      expect(await screen.findByRole('button', { name: t('field.copied') })).toBeDefined();
    });

    it('disables the copy button when the Clipboard API is unavailable (e.g. an insecure context)', () => {
      renderField();
      const copyButton = screen.getByRole<HTMLButtonElement>('button', {
        name: t('field.copy'),
      });
      expect(copyButton.disabled).toBe(true);
    });

    it('fails quietly — no confirmation, no unhandled rejection — when the API exists but the write itself is denied (confirmed live: a real automated-browser context rejects with exactly this)', async () => {
      const clipboard = mockRejectingClipboard();
      renderField();

      fireEvent.click(screen.getByRole('button', { name: t('field.copy') }));

      await waitFor(() => expect(clipboard.writeText).toHaveBeenCalled());
      expect(screen.queryByRole('button', { name: t('field.copied') })).toBeNull();
      expect(screen.getByRole('button', { name: t('field.copy') })).toBeDefined();
    });
  });

  it('the source never references fetch or XMLHttpRequest (ADR-005: no client-side subscription fetch)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, 'SubscriptionField.tsx'), 'utf8');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toContain('XMLHttpRequest');
  });
});
