// Bundles the extension into dist/ (load it unpacked from there), and with
// --zip also writes relay-extension-<version>.zip for the release.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const zip = process.argv.includes('--zip');
const out = 'dist';
const version = (process.env.RELAY_VERSION ?? JSON.parse(readFileSync('package.json', 'utf8')).version).replace(/^v/, '');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('public', out, { recursive: true });
cpSync('src/popup.html', path.join(out, 'popup.html'));
cpSync('src/offscreen.html', path.join(out, 'offscreen.html'));

const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
manifest.version = version.replace(/-.*$/, '');
writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));

const options = {
  entryPoints: {
    background: 'src/background.ts',
    offscreen: 'src/offscreen.ts',
    content: 'src/content.ts',
    popup: 'src/popup.tsx',
  },
  bundle: true,
  jsx: 'automatic',
  jsxImportSource: 'preact',
  format: 'esm',
  target: 'chrome116',
  outdir: out,
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
  if (zip) {
    const name = `relay-extension-${version}.zip`;
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
