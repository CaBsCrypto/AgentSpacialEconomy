import { build } from 'esbuild';
import path from 'node:path';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const walletDir = path.join(root, 'dist/vendor/wallet');
await build({
  entryPoints: [path.join(root, 'src/wallet-entry.mjs')],
  outfile: path.join(walletDir, 'kit.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  legalComments: 'linked',
  inject: [path.join(root, 'src/wallet-buffer.mjs')],
  define: { 'process.env.NODE_ENV': '"production"' },
});

// Keep the full upstream license texts beside the generated browser bundle.
const licensesDir = path.join(walletDir, 'licenses');
await mkdir(licensesDir, { recursive: true });
await Promise.all([
  ['smart-account-kit', 'smart-account-kit.LICENSE.txt'],
  ['@stellar/stellar-sdk', 'stellar-sdk.LICENSE.txt'],
  ['@stellar/stellar-base', 'stellar-base.LICENSE.txt'],
].map(([packageName, filename]) => copyFile(
  path.join(root, 'node_modules', packageName, 'LICENSE'),
  path.join(licensesDir, filename),
)));

await copyFile(path.join(root, 'node_modules/smart-account-kit/LICENSE'), path.join(walletDir, 'SMART-ACCOUNT-KIT-LICENSE.txt'));
