import { bundleStoreFrom, resolveActiveBundle, type StoredBundle } from '@mcs/schema-registry';
import type { StorageAdapter } from '@mcs/storage';
import { useEffect, useState, type ReactNode } from 'react';

import { CURRENT_APP_VERSION, defaultVerifyOptions } from '../bundle/verify-options.js';
import { t } from '../i18n/index.js';
import { DEFAULT_TARGET_PROFILE } from '../project/model.js';
import './AboutPage.css';

export interface AboutPageProps {
  readonly adapter: StorageAdapter;
}

/**
 * Version文档 §3's explicit hard requirement (PRD §2.3): both README and the
 * app's own "About" page must state that this is a community tool with no
 * affiliation with or endorsement by MetaCubeX. README already carries it;
 * `App.tsx`'s `ROUTES` had no page to carry the other half until this one
 * (v1.0.0 #4).
 *
 * Read-only and static: no button here writes anything, and the one piece of
 * async state (the active Bundle) is resolved the same local, network-free
 * way `BundlePage.tsx` already does (`bundleStoreFrom`/`resolveActiveBundle`
 * against local storage, never a network fetch) — this page must never
 * itself originate a network request (`no-network-egress` only polices
 * `packages/**`, so `apps/web` has to self-police, per this slice's own
 * engineering constraint).
 */
export function AboutPage({ adapter }: AboutPageProps): ReactNode {
  const [activeBundle, setActiveBundle] = useState<StoredBundle | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = bundleStoreFrom(adapter);
      const options = await defaultVerifyOptions();
      const resolved = await resolveActiveBundle(store, options);
      if (!cancelled) setActiveBundle(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  return (
    <div className="about-page">
      <a className="about-page__back" href="#/">
        {t('about.backToProject')}
      </a>
      <h1 className="about-page__title">{t('about.title')}</h1>

      <section className="about-page__section" aria-labelledby="about-disclaimer-heading">
        <h2 id="about-disclaimer-heading">{t('about.disclaimer.heading')}</h2>
        <p>{t('about.disclaimer.body')}</p>
      </section>

      <section className="about-page__section" aria-labelledby="about-version-heading">
        <h2 id="about-version-heading">{t('about.version.heading')}</h2>
        <dl className="about-page__version-info">
          <dt>{t('about.version.appLabel')}</dt>
          <dd>{CURRENT_APP_VERSION}</dd>
          <dt>{t('about.version.profileLabel')}</dt>
          <dd>{DEFAULT_TARGET_PROFILE}</dd>
          <dt>{t('about.version.bundleLabel')}</dt>
          <dd>
            {activeBundle
              ? t('about.version.bundleValue', {
                  version: activeBundle.manifest.version,
                  channel: activeBundle.manifest.channel,
                })
              : t('about.version.bundleLoading')}
          </dd>
        </dl>
      </section>

      <section className="about-page__section" aria-labelledby="about-license-heading">
        <h2 id="about-license-heading">{t('about.license.heading')}</h2>
        <p>
          {t('about.license.body')}{' '}
          <a
            href="https://github.com/SiVeci/mihomo-config-studio/blob/main/LICENSE"
            rel="noreferrer noopener"
            target="_blank"
          >
            LICENSE
          </a>
        </p>
      </section>

      <section className="about-page__section" aria-labelledby="about-privacy-heading">
        <h2 id="about-privacy-heading">{t('about.privacy.heading')}</h2>
        <p>{t('about.privacy.body')}</p>
        <a
          href="https://github.com/SiVeci/mihomo-config-studio/blob/main/SECURITY.md"
          rel="noreferrer noopener"
          target="_blank"
        >
          {t('about.privacy.link')}
        </a>
      </section>
    </div>
  );
}
