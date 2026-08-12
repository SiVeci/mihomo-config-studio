import { bytesToHex, canonicalManifestJson, type BundleManifest } from '@mcs/schema-registry';

/**
 * Decodes the base64 PKCS#8 private key (ADR-010 §2: `SCHEMA_SIGNING_KEY_B64`).
 * Pure — reading it from stdin is the caller's job (`index.ts`), so this
 * stays testable without any process I/O.
 */
export function decodePrivateKeyBase64(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64.trim(), 'base64'));
}

/**
 * Signs `canonicalManifestJson(manifest)` — the same function #8's verifier
 * uses — with the given PKCS#8 Ed25519 private key. `manifest.signature` is
 * ignored (canonicalManifestJson strips it); pass any placeholder.
 */
export async function signManifest(
  manifest: BundleManifest,
  privateKeyPkcs8: Uint8Array,
): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', privateKeyPkcs8, { name: 'Ed25519' }, false, [
    'sign',
  ]);
  const message = new TextEncoder().encode(canonicalManifestJson(manifest));
  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, key, message);
  return bytesToHex(new Uint8Array(signature));
}
