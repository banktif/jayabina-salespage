import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'admin', 'vendor');
await mkdir(vendor, { recursive: true });

await build({
  entryPoints: [path.join(root, 'admin-editor-src.js')],
  outfile: path.join(vendor, 'grapes-editor.bundle.js'),
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ['es2020'],
  format: 'iife',
  globalName: 'JayaGrapesFull',
  legalComments: 'eof',
  banner: { js: '/* JAYABINA Visual Editor — GrapesJS 0.23.2 full OSS bundle */' }
});

await copyFile(
  path.join(root, 'node_modules', 'grapesjs', 'dist', 'css', 'grapes.min.css'),
  path.join(vendor, 'grapes.min.css')
);

console.log('GrapesJS full editor bundle ready in admin/vendor');
