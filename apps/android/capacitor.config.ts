import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Product shell (v0.6.0 #3), replacing the M0-5 spike. `appId` is
 * unchangeable after first release (changing it means users must uninstall
 * and reinstall) — `studio.mihomoconfig.app` per the version plan's Q1
 * default. `webDir` points at `apps/web`'s own build output: this app loads
 * the same build artifact the Web deployment serves (ADR-001/ADR-026 —
 * one build, two hosts), not a separate Android-only bundle.
 */
const config: CapacitorConfig = {
  appId: 'studio.mihomoconfig.app',
  appName: 'Mihomo 配置工坊',
  webDir: '../web/dist',
};

export default config;
