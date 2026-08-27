// `pack` (tools/schema-cli) always signs before writing, but this job has
// deliberately no access to the production key (ADR-010 §1: the signing job
// never rebuilds, so the build job that *does* rebuild must never hold the
// key). A fresh, throwaway Ed25519 keypair — generated here, used once, held
// only in this process's memory, never written to disk or logged — lets
// `pack` run to completion. Its signature is immediately meaningless: the
// signing job re-signs the same manifest content with the production key,
// and `canonicalManifestJson` never includes the `signature` field in what
// gets signed, so re-signing is exact regardless of what the throwaway
// signature was.
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: pack-unsigned.mjs <...pack flags>');
  process.exit(1);
}

const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
const privateKeyBase64 = Buffer.from(pkcs8).toString('base64');

const child = spawn('node', ['tools/schema-cli/dist/index.js', 'pack', ...args], {
  stdio: ['pipe', 'inherit', 'inherit'],
});
child.stdin.write(privateKeyBase64);
child.stdin.end();
child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
