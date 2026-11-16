import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

fs.mkdirSync(distDir, { recursive: true });

// Compile MV3 background, relay, and popup scripts
execSync(
  'npx tsup src/background.ts src/relay.ts src/popup.ts --format esm --out-dir dist --clean',
  { cwd: rootDir, stdio: 'inherit' }
);

// Copy static MV3 assets and icons
for (const file of ['manifest.json', 'popup.html', 'popup.css']) {
  fs.copyFileSync(path.join(rootDir, 'public', file), path.join(distDir, file));
}
const iconsSrc = path.join(rootDir, 'public', 'icons');
const iconsOut = path.join(distDir, 'icons');
if (fs.existsSync(iconsSrc)) {
  fs.mkdirSync(iconsOut, { recursive: true });
  for (const file of fs.readdirSync(iconsSrc)) {
    fs.copyFileSync(path.join(iconsSrc, file), path.join(iconsOut, file));
  }
}

// Copy self-contained dom-blame IIFE bundle into extension dist
const coreIife = path.resolve(rootDir, '../../packages/core/dist/dom-blame.iife.js');
if (!fs.existsSync(coreIife)) {
  throw new Error(`Missing core IIFE bundle at ${coreIife}. Run packages/core build first.`);
}
fs.copyFileSync(coreIife, path.join(distDir, 'dom-blame.iife.js'));
console.log('[extension] Built MV3 bundle in apps/extension/dist');
