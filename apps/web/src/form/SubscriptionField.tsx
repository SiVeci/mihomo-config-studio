import type { ControlProps } from '@mcs/form-renderer';
import { useId, useState, type JSX } from 'react';

import { t } from '../i18n/index.js';
import './SubscriptionField.css';

/**
 * `proxy-providers`' `http.url` control (v0.3.0 #17, PRD §8.11, ADR-005):
 * the generic `secret` control's mask/reveal semantics, plus two things a
 * plain credential field does not need — an explicit copy action that never
 * first reveals the plaintext, and a standing notice that this app never
 * fetches the URL itself. ADR-005 decided against building that fetch at
 * all (CORS makes it unreliable, and a server that did it centrally would
 * turn subscription credentials into a juicy single target) — a user who
 * does not know that could easily mistake this quiet field for a broken one
 * instead of a boundary that was never going to be crossed.
 */
export function SubscriptionField({ field, id, onChange, disabled }: ControlProps): JSX.Element {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const describedBy = useId();
  const value = field.value == null ? '' : String(field.value);
  const isDisabled = disabled ?? false;
  // Checked per render, not once at module load: jsdom (and some real
  // insecure-context pages) never define `navigator.clipboard` at all, and a
  // render-time check is what lets a test simulate either environment
  // instead of racing this module's own import against a test's setup code.
  const clipboardAvailable = typeof navigator !== 'undefined' && Boolean(navigator.clipboard);

  async function handleCopy(): Promise<void> {
    if (!clipboardAvailable) return;
    // The API existing is not a guarantee it will actually write: a
    // permissions-policy restriction (confirmed live: an automated browser
    // context denies it outright) or a lack of document focus can still
    // reject at call time. Failing quietly — no confirmation shown, nothing
    // thrown — is the right degradation for a convenience action; the input
    // itself is always still there to copy by hand.
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span className="subscription-field">
      <input
        type={revealed ? 'text' : 'password'}
        id={id}
        className="subscription-field__input"
        value={value}
        readOnly={field.readOnly}
        disabled={isDisabled}
        required={field.required}
        aria-describedby={describedBy}
        onChange={(event) => {
          setCopied(false);
          onChange(field.path, event.target.value);
        }}
      />
      <button
        type="button"
        disabled={isDisabled}
        onClick={() => setRevealed((current) => !current)}
      >
        {revealed ? t('field.hide') : t('field.reveal')}
      </button>
      <button
        type="button"
        disabled={isDisabled || !clipboardAvailable}
        onClick={() => void handleCopy()}
      >
        {copied ? t('field.copied') : t('field.copy')}
      </button>
      <span id={describedBy} className="subscription-field__notice">
        {t('form.subscriptionUrl.notice')}
      </span>
    </span>
  );
}
