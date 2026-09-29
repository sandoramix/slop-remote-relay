// Bundles the extension into dist/ (load it unpacked from there), and with
// --zip also writes relay-extension-<version>.zip for the release. --store
// drops the manifest's `key` (the Chrome Web Store rejects it and assigns its
// own id) and names the zip relay-extension-<version>-store.zip.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const store = process.argv.includes('--store');
const zip = store || process.argv.includes('--zip');
const out = 'dist';
const version = (process.env.RELAY_VERSION ?? JSON.parse(readFileSync('package.json', 'utf8')).version).replace(/^v/, '');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('public', out, { recursive: true });
cpSync('src/popup.html', path.join(out, 'popup.html'));
cpSync('src/offscreen.html', path.join(out, 'offscreen.html'));

const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
manifest.version = version.replace(/-.*$/, '');
if (store) {
  delete manifest.key;
  // Only the GitHub update check uses alarms, and store installs skip it.
  manifest.permissions = manifest.permissions.filter((p) => p !== 'alarms');
}
writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));

const common = {
  bundle: true,
  jsx: 'automatic',
  jsxImportSource: 'preact',
  target: 'chrome116',
  outdir: out,
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
};
const builds = [
  {
    ...common,
    entryPoints: { background: 'src/background.ts', offscreen: 'src/offscreen.ts', popup: 'src/popup.tsx' },
    format: 'esm',
  },
  // The worker re-injects the content script into tabs that were already open;
  // as a classic script it must not leave top-level bindings behind to collide.
  { ...common, entryPoints: { content: 'src/content.ts' }, format: 'iife' },
];

if (watch) {
  for (const b of builds) await (await context(b)).watch();
} else {
  await Promise.all(builds.map((b) => build(b)));
  if (zip) {
    const name = `relay-extension-${version}${store ? '-store' : ''}.zip`;
    rmSync(name, { force: true });
    // Bundled PowerShell on Windows, zip elsewhere: CI runs on Linux.
    if (process.platform === 'win32') {
      execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path ${out}\\* -DestinationPath ${name}`]);
    } else {
      execFileSync('zip', ['-qr', path.resolve(name), '.'], { cwd: out });
    }
    console.log(`wrote ${name}`);
  }
}
