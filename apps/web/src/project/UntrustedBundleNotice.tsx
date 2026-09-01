import type { BundleTrust } from '@mcs/schema-registry';
import type { ReactNode } from 'react';

import { t } from '../i18n/index.js';
import './UntrustedBundleNotice.css';

export interface UntrustedBundleNoticeProps {
  readonly bundleTrust: BundleTrust;
}

/**
 * FR-UPD-09 (v0.9.0 #17): persistently visible for the whole time a project
 * uses an untrusted Bundle — never just a one-time popup at install time
 * (ADR-002: the Bundle decides what a form renders, so the user needs to
 * always know whose knowledge that is). Deliberately its own component
 * rather than added into `StatusBar.tsx`: `StatusBar` is CSS-hidden outside
 * `AppShell`'s narrow-screen breakpoint, so a warning that lived only there
 * would silently disappear on desktop. This instead follows
 * `StoragePressureNotice`'s own pattern one line above it in `ProjectPage`'s
 * render tree — a small `role="status"` element with no viewport gating of
 * its own, rendering nothing when there is nothing to report.
 */
export function UntrustedBundleNotice({ bundleTrust }: UntrustedBundleNoticeProps): ReactNode {
  if (bundleTrust !== 'untrusted') return null;
  return (
    <p className="untrusted-bundle-notice" role="status">
      {t('bundle.trust.untrustedWarning')}
    </p>
  );
}
