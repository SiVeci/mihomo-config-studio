// ADR-010 §4 / ADR-024: the production private key must never appear on a
// shell command line, and must never be echoed. GitHub's log masking only
// covers the *exact* secret string — a `printf '%s' "${{ secrets.X }}" | cli`
// step interpolates the secret into the command line before the shell ever
// runs it, which is exactly what this script avoids. The workflow injects
// the key via `env:` (GitHub still masks it there); this script reads it
// from `process.env` — never argv, never a template-interpolated shell
// string — and writes it straight to the child process's stdin.
import { spawn } from 'node:child_process';

const key = process.env.SCHEMA_SIGNING_KEY_B64;
if (!key) {
  console.error('SCHEMA_SIGNING_KEY_B64 is not set.');
  process.exit(1);
}

const [manifestFile, outFile] = process.argv.slice(2);
if (!manifestFile || !outFile) {
  console.error('Usage: sign-manifest.mjs <manifest-file> <out-file>');
  process.exit(1);
}

const child = spawn(
  'node',
  ['tools/schema-cli/dist/index.js', 'sign', '--manifest', manifestFile, '--out', outFile],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
child.stdin.write(key);
child.stdin.end();
child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
