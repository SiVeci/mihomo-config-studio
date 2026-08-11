/**
 * Fresh Ed25519 key pairs for tests. Excluded from coverage (see
 * `vitest.config.ts`) and must never be imported from production source —
 * the built-in bundle's own trust anchor lives in `builtin.ts`, generated
 * once offline, not through this module.
 */
export interface TestKeyPair {
  readonly publicKeyRaw: Uint8Array;
  sign(message: Uint8Array): Promise<Uint8Array>;
}

export async function generateTestKeyPair(): Promise<TestKeyPair> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  // Ed25519 always yields a pair; `generateKey`'s return type is a union
  // because the same overload also covers symmetric algorithms.
  if (!('publicKey' in pair) || !('privateKey' in pair)) {
    throw new Error('Ed25519 key generation did not return a key pair');
  }
  const { publicKey, privateKey } = pair;
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
  return {
    publicKeyRaw,
    async sign(message: Uint8Array): Promise<Uint8Array> {
      const signature = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, message);
      return new Uint8Array(signature);
    },
  };
}
