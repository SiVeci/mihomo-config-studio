import {
  applyUpdate,
  bundleStoreFrom,
  channelSlotKey,
  DEFAULT_BUNDLE_CHANNEL,
  fetchBundle,
  planUpdate,
  readBundleChannelPreference,
  resolveActiveBundle,
  rollbackBundle,
  writeBundleChannelPreference,
  type BundleChannel,
  type BundleSource,
  type BundleStore,
  type FetchBytes,
  type PlanUpdateReason,
  type StoredBundle,
} from '@mcs/schema-registry';
import type { StorageAdapter } from '@mcs/storage';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { t, type TranslationKey } from '../i18n/index.js';
import { BUNDLE_TRUST_ANCHORS } from './trust-anchors.js';
import './BundlePage.css';

/** Matches `apps/web/package.json`'s own `version` — the same value every `requiresApp` fixture/test in this repo already assumes. */
const CURRENT_APP_VERSION = '0.1.0';
const MIN_FORMAT_VERSION = 1;
const MAX_FORMAT_VERSION = 1;
const CHANNELS: readonly BundleChannel[] = ['stable', 'beta'];

type InstallOutcome =
  | { readonly kind: 'up-to-date' }
  | { readonly kind: 'not-worth-it'; readonly reason: PlanUpdateReason }
  | { readonly kind: 'success' }
  | { readonly kind: 'error'; readonly code: string; readonly path?: string };

type RollbackOutcome =
  { readonly kind: 'success' } | { readonly kind: 'error'; readonly code: string };

export interface BundlePageProps {
  readonly adapter: StorageAdapter;
  /** Build-time constant per channel (decision F4) — a channel with no entry here shows "not configured" rather than attempting a request. */
  readonly updateSources?: Partial<Record<BundleChannel, BundleSource>>;
  /** Test-only network override; production code leaves this unset so `fetchBundle` uses the real `fetch`. */
  readonly fetchBytes?: FetchBytes;
  /** Test-only trust anchor override; production code leaves this unset so verification uses `resolveTrustAnchors()`'s real result (`trust-anchors.ts`). */
  readonly trustedPublicKeys?: readonly Uint8Array[];
}

const REASON_KEY: Record<PlanUpdateReason, TranslationKey> = {
  NOT_NEWER: 'bundle.install.reason.NOT_NEWER',
  CHANNEL_MISMATCH: 'bundle.install.reason.CHANNEL_MISMATCH',
  FORMAT_UNSUPPORTED: 'bundle.install.reason.FORMAT_UNSUPPORTED',
};

/**
 * A stable error/reason code always maps to i18n text plus, where relevant,
 * a structural `path` — never a response body, a URL, or an HTTP status
 * text (NFR-SEC-03). `bundle.error.unknown` is the fallback for any code
 * this map does not yet name explicitly, so an unrecognised code still
 * renders *something* rather than a blank error.
 */
function errorMessageKey(code: string): TranslationKey {
  const key = `bundle.error.${code}` as TranslationKey;
  return key in ERROR_CODES ? key : 'bundle.error.unknown';
}

const ERROR_CODES: Record<string, true> = {
  'bundle.error.BUNDLE_MANIFEST_MISSING_FIELD': true,
  'bundle.error.BUNDLE_MANIFEST_INVALID_TYPE': true,
  'bundle.error.BUNDLE_FORMAT_UNSUPPORTED': true,
  'bundle.error.BUNDLE_APP_TOO_OLD': true,
  'bundle.error.BUNDLE_HASH_MISMATCH': true,
  'bundle.error.BUNDLE_SIGNATURE_INVALID': true,
  'bundle.error.UPDATER_FETCH_FAILED': true,
  'bundle.error.BUNDLE_STORE_NO_PREVIOUS': true,
};

function verifyOptions(channel: BundleChannel, trustedPublicKeys: readonly Uint8Array[]) {
  return {
    currentAppVersion: CURRENT_APP_VERSION,
    minFormatVersion: MIN_FORMAT_VERSION,
    maxFormatVersion: MAX_FORMAT_VERSION,
    trustedPublicKeys,
    channel,
  };
}

export function BundlePage({
  adapter,
  updateSources,
  fetchBytes,
  trustedPublicKeys,
}: BundlePageProps): ReactNode {
  const [store] = useState<BundleStore>(() => bundleStoreFrom(adapter));
  const [channel, setChannel] = useState<BundleChannel>(DEFAULT_BUNDLE_CHANNEL);
  const [activeBundle, setActiveBundle] = useState<StoredBundle | undefined>(undefined);
  const [rollbackAvailable, setRollbackAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [installOutcome, setInstallOutcome] = useState<InstallOutcome | undefined>(undefined);
  const [rollbackOutcome, setRollbackOutcome] = useState<RollbackOutcome | undefined>(undefined);
  const trustAnchors = trustedPublicKeys ?? BUNDLE_TRUST_ANCHORS.anchors;
  // A newer refresh (a later channel switch, a later install/rollback) can
  // resolve before an older, still-in-flight one — without a guard, the
  // stale result would land last and overwrite the fresher display with
  // the wrong channel's data. Only the most recently *started* refresh is
  // allowed to actually apply its result.
  const refreshGeneration = useRef(0);

  const refresh = useCallback(
    async (forChannel: BundleChannel) => {
      const generation = ++refreshGeneration.current;
      const options = verifyOptions(forChannel, trustAnchors);
      const [resolved, previous] = await Promise.all([
        resolveActiveBundle(store, options, forChannel),
        store.read(channelSlotKey(forChannel, 'previous')),
      ]);
      if (generation !== refreshGeneration.current) return;
      setActiveBundle(resolved);
      setRollbackAvailable(previous !== null);
    },
    [store, trustAnchors],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const preferred = await readBundleChannelPreference(adapter);
      if (cancelled) return;
      setChannel(preferred);
      await refresh(preferred);
    })();
    return () => {
      cancelled = true;
    };
    // In practice runs once on mount: `adapter` is a stable prop and
    // `refresh` is a stable identity (its own `useCallback` depends only on
    // `store`, itself fixed for this component's lifetime via `useState`).
  }, [adapter, refresh]);

  const handleChannelSwitch = useCallback(
    async (nextChannel: BundleChannel) => {
      if (nextChannel === channel) return;
      await writeBundleChannelPreference(adapter, nextChannel);
      setChannel(nextChannel);
      setInstallOutcome(undefined);
      setRollbackOutcome(undefined);
      await refresh(nextChannel);
    },
    [adapter, channel, refresh],
  );

  const handleCheckAndInstall = useCallback(async () => {
    const source = updateSources?.[channel];
    if (!source || !activeBundle) return;

    setBusy(true);
    setInstallOutcome(undefined);
    try {
      const candidate = await fetchBundle(source, fetchBytes);
      if (!candidate.ok) {
        setInstallOutcome({ kind: 'error', code: candidate.code, path: candidate.path });
        return;
      }

      const plan = planUpdate(activeBundle.manifest, candidate.manifest, {
        channel,
        minFormatVersion: MIN_FORMAT_VERSION,
        maxFormatVersion: MAX_FORMAT_VERSION,
      });
      if (!plan.shouldUpdate) {
        setInstallOutcome(
          plan.reason === 'NOT_NEWER'
            ? { kind: 'up-to-date' }
            : { kind: 'not-worth-it', reason: plan.reason },
        );
        return;
      }

      const result = await applyUpdate(store, candidate, verifyOptions(channel, trustAnchors));
      if (!result.ok) {
        setInstallOutcome({ kind: 'error', code: result.code, path: result.path });
        return;
      }
      setInstallOutcome({ kind: 'success' });
    } finally {
      setBusy(false);
      await refresh(channel);
    }
  }, [activeBundle, channel, fetchBytes, refresh, store, trustAnchors, updateSources]);

  const handleRollback = useCallback(async () => {
    setBusy(true);
    setRollbackOutcome(undefined);
    try {
      const result = await rollbackBundle(store, channel);
      setRollbackOutcome(result.ok ? { kind: 'success' } : { kind: 'error', code: result.code });
    } finally {
      setBusy(false);
      await refresh(channel);
    }
  }, [channel, refresh, store]);

  return (
    <div className="bundle-page">
      <a className="bundle-page__back" href="#/">
        {t('bundle.backToProject')}
      </a>
      <h1 className="bundle-page__title">{t('bundle.title')}</h1>

      <section className="bundle-page__section" aria-labelledby="bundle-channel-heading">
        <h2 id="bundle-channel-heading">{t('bundle.channel.heading')}</h2>
        <div
          className="bundle-page__channel-switch"
          role="group"
          aria-label={t('bundle.channel.heading')}
        >
          {CHANNELS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className="bundle-page__channel-button"
              aria-pressed={candidate === channel}
              disabled={busy}
              onClick={() => void handleChannelSwitch(candidate)}
            >
              {t(candidate === 'stable' ? 'bundle.channel.stable' : 'bundle.channel.beta')}
            </button>
          ))}
        </div>
      </section>

      <section className="bundle-page__section" aria-labelledby="bundle-active-heading">
        <h2 id="bundle-active-heading">{t('bundle.active.heading')}</h2>
        {!activeBundle ? (
          <p>{t('bundle.active.loading')}</p>
        ) : (
          <dl className="bundle-page__active-info">
            <dt>{t('bundle.active.bundleIdLabel')}</dt>
            <dd>{t('bundle.active.bundleId', { value: activeBundle.manifest.bundleId })}</dd>
            <dt>{t('bundle.active.versionLabel')}</dt>
            <dd>{t('bundle.active.version', { value: activeBundle.manifest.version })}</dd>
            <dt>{t('bundle.active.channelLabel')}</dt>
            <dd>{t('bundle.active.channel', { value: activeBundle.manifest.channel })}</dd>
            <dt>{t('bundle.active.mihomoRangeLabel')}</dt>
            <dd>
              {t('bundle.active.mihomoRange', {
                min: activeBundle.manifest.mihomo.minVersion,
                max: activeBundle.manifest.mihomo.maxTestedVersion,
              })}
            </dd>
          </dl>
        )}
      </section>

      <section className="bundle-page__section" aria-labelledby="bundle-install-heading">
        <h2 id="bundle-install-heading">{t('bundle.install.heading')}</h2>
        {!updateSources?.[channel] ? (
          <p>{t('bundle.install.sourceUnavailable', { channel: t(channelLabelKey(channel)) })}</p>
        ) : (
          <>
            <button
              type="button"
              className="bundle-page__install-button"
              disabled={busy || !activeBundle}
              onClick={() => void handleCheckAndInstall()}
            >
              {busy ? t('bundle.install.checking') : t('bundle.install.checkButton')}
            </button>
            {installOutcome && (
              <p role="status" className="bundle-page__outcome">
                {renderInstallOutcome(installOutcome)}
              </p>
            )}
          </>
        )}
      </section>

      <section className="bundle-page__section" aria-labelledby="bundle-rollback-heading">
        <h2 id="bundle-rollback-heading">{t('bundle.rollback.heading')}</h2>
        <button
          type="button"
          className="bundle-page__rollback-button"
          disabled={busy || !rollbackAvailable}
          onClick={() => void handleRollback()}
        >
          {t('bundle.rollback.button')}
        </button>
        {!rollbackAvailable && <p>{t('bundle.rollback.unavailable')}</p>}
        {rollbackOutcome && (
          <p role="status" className="bundle-page__outcome">
            {rollbackOutcome.kind === 'success'
              ? t('bundle.rollback.success')
              : `${t(errorMessageKey(rollbackOutcome.code))}`}
          </p>
        )}
      </section>
    </div>
  );
}

function renderInstallOutcome(outcome: InstallOutcome): string {
  switch (outcome.kind) {
    case 'up-to-date':
      return t('bundle.install.upToDate');
    case 'not-worth-it':
      return t(REASON_KEY[outcome.reason]);
    case 'success':
      return t('bundle.install.success');
    case 'error':
      return outcome.path
        ? `${t(errorMessageKey(outcome.code))} ${t('bundle.error.path', { path: outcome.path })}`
        : t(errorMessageKey(outcome.code));
  }
}

function channelLabelKey(channel: BundleChannel): TranslationKey {
  return channel === 'stable' ? 'bundle.channel.stable' : 'bundle.channel.beta';
}
