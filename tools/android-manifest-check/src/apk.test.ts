import { describe, expect, it } from 'vitest';

import { checkApkPermissions, extractUsesPermissions } from './apk.js';

/** Real `aapt2 dump permissions app-debug.apk` output against the product shell (v0.6.0 #3/#4), re-captured — not hand-written. */
const REAL_CLEAN_DUMP = `package: studio.mihomoconfig.app
uses-permission: name='android.permission.INTERNET'
permission: studio.mihomoconfig.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION
uses-permission: name='studio.mihomoconfig.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'
`;

describe('extractUsesPermissions', () => {
  it('extracts every uses-permission name from a real dump, in order', () => {
    expect(extractUsesPermissions(REAL_CLEAN_DUMP)).toEqual([
      'android.permission.INTERNET',
      'studio.mihomoconfig.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
    ]);
  });

  it('ignores bare "permission:" lines — those declare a custom permission, not a request', () => {
    const names = extractUsesPermissions(REAL_CLEAN_DUMP);
    expect(names).not.toContain('studio.mihomoconfig.app'); // the "package:" line
    expect(names.filter((name) => name.includes('DYNAMIC_RECEIVER'))).toHaveLength(1); // the uses-permission line, not the permission: declaration line too
  });

  it('returns an empty array for a dump with no uses-permission lines', () => {
    expect(extractUsesPermissions('package: studio.mihomoconfig.app\n')).toEqual([]);
  });

  it('reads uses-permission-sdk-23 lines the same way', () => {
    const dump = "uses-permission-sdk-23: name='android.permission.READ_EXTERNAL_STORAGE'\n";
    expect(extractUsesPermissions(dump)).toEqual(['android.permission.READ_EXTERNAL_STORAGE']);
  });
});

describe('checkApkPermissions (FR-AND-06, produced-artifact level, v0.6.0 #4)', () => {
  it('passes the real product shell dump — INTERNET + the AndroidX DYNAMIC_RECEIVER permission only', () => {
    const result = checkApkPermissions(REAL_CLEAN_DUMP);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('flags a VPN permission the merged manifest ended up with', () => {
    const dump = `${REAL_CLEAN_DUMP}uses-permission: name='android.permission.BIND_VPN_SERVICE'\n`;
    const result = checkApkPermissions(dump);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(['android.permission.BIND_VPN_SERVICE']);
  });

  it('flags a broad storage permission the merged manifest ended up with', () => {
    const dump = `${REAL_CLEAN_DUMP}uses-permission: name='android.permission.WRITE_EXTERNAL_STORAGE'\n`;
    const result = checkApkPermissions(dump);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(['android.permission.WRITE_EXTERNAL_STORAGE']);
  });

  it('flags any permission not on the whitelist, even one no blocklist token would name', () => {
    const dump = `${REAL_CLEAN_DUMP}uses-permission: name='android.permission.READ_CONTACTS'\n`;
    const result = checkApkPermissions(dump);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(['android.permission.READ_CONTACTS']);
  });

  it('never flags another package’s own DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION suffix match', () => {
    const dump =
      "uses-permission: name='com.example.otherlib.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'\n";
    expect(checkApkPermissions(dump).ok).toBe(true);
  });
});
