import type { CapacitorConfig } from '@capacitor/cli';

/**
 * M0-5 spike shell — verifies SAF open/save, ACTION_SEND share, and private
 * `filesDir` storage work through Capacitor, nothing more. Not the product
 * app id; the real one is decided when this shell is replaced in v0.6.0.
 */
const config: CapacitorConfig = {
  appId: 'studio.mihomoconfig.m0spike',
  appName: 'MCS M0 Spike',
  webDir: 'dist',
};

export default config;
