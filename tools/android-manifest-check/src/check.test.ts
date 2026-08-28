import { describe, expect, it } from 'vitest';

import { checkManifestXml } from './check.js';

const CLEAN_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application>
        <activity android:name=".MainActivity" />
    </application>
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>`;

function withInjected(fragment: string): string {
  return CLEAN_MANIFEST.replace('</manifest>', `${fragment}</manifest>`);
}

describe('checkManifestXml', () => {
  it('passes a manifest with only INTERNET permission', () => {
    const result = checkManifestXml(CLEAN_MANIFEST);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('flags BIND_VPN_SERVICE', () => {
    const xml = withInjected(
      '<service android:name=".MyVpnService" android:permission="android.permission.BIND_VPN_SERVICE" />',
    );
    const result = checkManifestXml(xml);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.stringContaining('BIND_VPN_SERVICE')]),
    );
  });

  it('flags an android.net.VpnService intent-filter action', () => {
    const xml = withInjected(
      '<service android:name=".MyVpnService"><intent-filter>' +
        '<action android:name="android.net.VpnService" /></intent-filter></service>',
    );
    const result = checkManifestXml(xml);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.stringContaining('android.net.VpnService')]),
    );
  });

  it('flags the bare FOREGROUND_SERVICE permission', () => {
    const xml = withInjected(
      '<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
    );
    const result = checkManifestXml(xml);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.stringContaining('FOREGROUND_SERVICE')]),
    );
  });

  it('flags typed FOREGROUND_SERVICE_* variants (Android 14+)', () => {
    const xml = withInjected(
      '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />',
    );
    const result = checkManifestXml(xml);
    expect(result.ok).toBe(false);
  });

  it('flags READ_EXTERNAL_STORAGE', () => {
    const xml = withInjected(
      '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />',
    );
    const result = checkManifestXml(xml);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.stringContaining('READ_EXTERNAL_STORAGE')]),
    );
  });

  it('flags WRITE_EXTERNAL_STORAGE', () => {
    const xml = withInjected(
      '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />',
    );
    const result = checkManifestXml(xml);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.stringContaining('WRITE_EXTERNAL_STORAGE')]),
    );
  });

  it('flags MANAGE_EXTERNAL_STORAGE', () => {
    const xml = withInjected(
      '<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />',
    );
    const result = checkManifestXml(xml);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.stringContaining('MANAGE_EXTERNAL_STORAGE')]),
    );
  });

  it('flags ACCESS_BACKGROUND_LOCATION', () => {
    const xml = withInjected(
      '<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />',
    );
    const result = checkManifestXml(xml);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.stringContaining('ACCESS_BACKGROUND_LOCATION')]),
    );
  });

  it('reports every violation when a manifest has more than one', () => {
    const xml = withInjected(
      '<uses-permission android:name="android.permission.BIND_VPN_SERVICE" />' +
        '<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
    );
    const result = checkManifestXml(xml);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(2);
  });
});
