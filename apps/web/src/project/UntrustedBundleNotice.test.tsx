// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { t } from '../i18n/index.js';
import { UntrustedBundleNotice } from './UntrustedBundleNotice.js';

afterEach(() => {
  cleanup();
});

describe('UntrustedBundleNotice (FR-UPD-09, v0.9.0 #17)', () => {
  it('renders nothing for a builtin bundle', () => {
    const { container } = render(<UntrustedBundleNotice bundleTrust="builtin" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a signed bundle', () => {
    const { container } = render(<UntrustedBundleNotice bundleTrust="signed" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a persistent warning naming exactly what was not verified — the signature origin — for an untrusted bundle', () => {
    render(<UntrustedBundleNotice bundleTrust="untrusted" />);
    const notice = screen.getByRole('status');
    expect(notice.textContent).toBe(t('bundle.trust.untrustedWarning'));
  });

  it('never uses a vague "might be unsafe"-style phrase (PRD requirement: name what was not verified)', () => {
    render(<UntrustedBundleNotice bundleTrust="untrusted" />);
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).not.toContain('可能不安全');
    expect(text.toLowerCase()).not.toContain('might not be safe');
  });
});
