// Builds an AltStore (Classic) / SideStore source from the repository's GitHub
// releases, so the iOS controller can be installed and updated from AltStore.
//
//   GITHUB_TOKEN=… node tools/altstore-source.mjs <out-dir> [ios-info.json]
//
// Every published release carrying a relay-controller-*-unsigned.ipa becomes a
// version; AltStore re-signs the unsigned build with the user's own Apple ID.
// ios-info.json comes from the macOS build (minimum iOS, privacy strings,
// entitlements), because AltStore requires a source to declare every
// permission the app uses. Format: https://faq.altstore.io/developers/make-a-source
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [outDir = 'site', infoPath] = process.argv.slice(2);
const repo = process.env.GITHUB_REPOSITORY ?? 'sandoramix/slop-remote-relay';
const [owner, name] = repo.split('/');
const pagesBase = `https://${owner.toLowerCase()}.github.io/${name}`;
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

const info = infoPath && existsSync(infoPath) ? JSON.parse(readFileSync(infoPath, 'utf8')) : {};

async function releases() {
  const all = [];
  for (let page = 1; page < 10; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, {
      headers: {
        accept: 'application/vnd.github+json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all.filter((r) => !r.draft && !r.prerelease);
}

/** Same scheme as app.config.ts: major*10000 + minor*100 + patch. */
const buildNumber = (v) => {
  const [a = 0, b = 0, c = 0] = v.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  return String(a * 10_000 + b * 100 + c);
};

/** The "What's changed" part of our generated notes, as plain text for AltStore. */
function whatsNew(body = '') {
  const start = body.indexOf("## What's changed");
  const end = body.indexOf('## Downloads');
  const section = body.slice(start >= 0 ? start : 0, end > 0 ? end : undefined);
  const text = section
    .replace(/^## What's changed\s*/m, '')
    .replace(/^### (.+)$/gm, '$1:')
    .replace(/\*\*/g, '')
    .replace(/ \([0-9a-f]{7}\)$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > 3000 ? `${text.slice(0, 2990)}…` : text;
}

const versions = (await releases())
  .map((r) => {
    const ipa = r.assets.find((a) => /^relay-controller-.+-unsigned\.ipa$/.test(a.name));
    if (!ipa) return null;
    const version = r.tag_name.replace(/^v/, '');
    return {
      version,
      buildVersion: buildNumber(version),
      date: r.published_at,
      localizedDescription: whatsNew(r.body),
      downloadURL: ipa.browser_download_url,
      size: ipa.size,
      ...(info.minOSVersion && r.tag_name === info.tag ? { minOSVersion: info.minOSVersion } : {}),
    };
  })
  .filter(Boolean);

if (versions.length === 0) {
  console.error('no release carries an iOS build yet; nothing to publish');
  // exitCode, not exit(): exiting with a fetch socket still open trips a libuv
  // assertion on Windows.
  process.exitCode = 3;
} else {
  publish();
}

function publish() {

const source = {
  name: 'Skipper',
  subtitle: 'Skip the intro from the sofa',
  description:
    'Skipper turns your iPhone into the remote for a video playing on an Android phone or in a desktop browser: jump by any amount, scrub, play/pause and go fullscreen, over Wi-Fi, WebRTC, your relay server, MQTT or Bluetooth.',
  iconURL: `${pagesBase}/icon.png`,
  website: `https://github.com/${repo}`,
  tintColor: '#E8B04B',
  apps: [
    {
      name: 'Skipper',
      bundleIdentifier: 'dev.sandoramix.skipper',
      developerName: owner,
      subtitle: 'The remote',
      localizedDescription:
        'The remote. Pair it with Skipper Screen on an Android phone or with Skipper for Chrome, then skip, scrub, pause and go fullscreen from the sofa. Setup guide: ' +
        `https://github.com/${repo}#getting-started`,
      iconURL: `${pagesBase}/icon.png`,
      tintColor: '#E8B04B',
      category: 'utilities',
      versions,
      appPermissions: {
        entitlements: info.entitlements ?? [],
        privacy: info.privacy ?? {},
      },
    },
  ],
  news: [],
};

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'altstore.json'), JSON.stringify(source, null, 2));
copyFileSync('apps/controller/assets/images/icon.png', path.join(outDir, 'icon.png'));
writeFileSync(
  path.join(outDir, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Relay for AltStore</title>
<body style="font:16px system-ui;background:#14181e;color:#ede9e3;max-width:40rem;margin:3rem auto;padding:0 1rem">
<h1>Relay</h1><p>Add this source in AltStore or SideStore (Browse → Sources → +):</p>
<pre style="background:#1d232b;padding:1rem;border-radius:12px;overflow:auto">${pagesBase}/altstore.json</pre>
<p><a style="color:#e8b04b" href="https://github.com/${repo}">Project on GitHub</a></p></body>`,
);
console.log(`altstore.json: ${versions.length} version(s), latest ${versions[0].version}`);
}
