import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
await build({ entryPoints: [path.join(root, 'src/ads-wallet-entry.mjs')], outfile: path.join(root, 'dist/vendor/ads-wallet/kit.mjs'), bundle: true, format: 'esm', platform: 'browser', target: ['es2022'], minify: true, legalComments: 'linked', inject: [path.join(root, 'src/wallet-buffer.mjs')], define: { 'process.env.NODE_ENV': '"production"' } });
