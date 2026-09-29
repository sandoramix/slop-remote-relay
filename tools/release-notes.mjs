// Release notes for a tag, from the commits since the previous tag.
//
//   node tools/release-notes.mjs v0.3.0 [--throwaway-key] > notes.md
//
// Commits follow Conventional Commits (feat, fix, docs, ci, …, optional scope),
// so they group themselves. A hand-written introduction for a version can go
// in .github/release-notes/<tag>.md; it is placed on top as "Highlights".
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const tag = process.argv[2];
const throwaway = process.argv.includes('--throwaway-key');
const repo = process.env.GITHUB_REPOSITORY ?? 'sandoramix/slop-remote-relay';
const owner = repo.split('/')[0].toLowerCase();
if (!tag) {
  console.error('usage: node tools/release-notes.mjs <tag> [--throwaway-key]');
  process.exit(2);
}

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

// The previous version tag reachable from this one, if any.
let previous = null;
try {
  previous = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*', `${tag}^`);
} catch {
  /* first release: take the whole history */
}
const range = previous ? `${previous}..${tag}` : tag;

const SEP = '\x1f';
const commits = git('log', '--no-merges', `--format=%H${SEP}%s`, range)
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [hash, subject] = line.split(SEP);
    const m = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
    return m
      ? { hash, type: m[1].toLowerCase(), scope: m[2] ?? null, breaking: !!m[3], text: m[4] }
      : { hash, type: 'other', scope: null, breaking: false, text: subject };
  });

const SECTIONS = [
  ['Features', ['feat']],
  ['Fixes', ['fix']],
  ['Performance', ['perf']],
  ['Documentation', ['docs']],
  ['Tests and tools', ['test', 'tools']],
  ['Maintenance', ['ci', 'build', 'chore', 'refactor', 'style', 'other']],
];

const line = (c) =>
  `- ${c.breaking ? '**BREAKING** ' : ''}${c.scope ? `**${c.scope}:** ` : ''}${c.text} (${c.hash.slice(0, 7)})`;

const out = [];
const highlights = `.github/release-notes/${tag}.md`;
if (existsSync(highlights)) {
  out.push('## Highlights', '', readFileSync(highlights, 'utf8').trim(), '');
}

out.push("## What's changed", '');
for (const [title, types] of SECTIONS) {
  const group = commits.filter((c) => types.includes(c.type));
  if (group.length === 0) continue;
  out.push(`### ${title}`, '', ...group.map(line), '');
}
if (commits.length === 0) out.push('No changes since the previous release.', '');

out.push(
  '## Downloads',
  '',
  '| File | What it is |',
  '|---|---|',
  '| `relay-receiver-*.apk` | Install on the Android phone that plays the video |',
  '| `relay-controller-*.apk` | Install on the phone you hold as the remote |',
  '| `relay-controller-*-unsigned.ipa` | iOS remote, unsigned: re-sign with your own Apple ID to install |',
  '| `relay-extension-*.zip` | Chrome/Brave: unzip, open `chrome://extensions`, enable Developer mode, *Load unpacked* |',
  '| `skipper-chrome-web-store-*.zip` | The extension without its fixed id, for uploading to the Chrome Web Store (not for loading unpacked) |',
  '| `relay-server-*.tgz` | Relay server (Node 22): `npm install --omit=dev && node dist/server.js` |',
  '| `SHA256SUMS.txt` | Checksums of every file above |',
  '',
  `Relay server container: \`docker run -p 8080:8080 ghcr.io/${owner}/slop-remote-relay-server:${tag}\``,
  '',
  // Optional, and the same for every release: collapsed so it doesn't bury the changes.
  '<details>',
  '<summary><b>Optional: Shizuku on the receiver</b> — fullscreen keys and taps without accessibility</summary>',
  '',
  'Relay never depends on Shizuku; without it, commands go through MediaSession and Accessibility.',
  'Shizuku has to be started again after every reboot of the receiver.',
  '',
  '1. Install Shizuku on the receiver, from [its releases](https://github.com/RikkaApps/Shizuku/releases/latest) or Google Play:',
  '   ```bash',
  '   gh release download -R RikkaApps/Shizuku -p "*.apk" -O shizuku.apk',
  '   adb install shizuku.apk',
  '   ```',
  '2. Open Shizuku once, then start it. On Android 11 and later: *Start via Wireless debugging* in the app.',
  '   On Android 10 and older, or from a computer: with the receiver connected over `adb`, run the starter',
  '   bundled in the APK (`arm64` on most phones and tablets, `arm` on 32-bit ones, `x86_64` on an emulator):',
  '   ```bash',
  "   DIR=$(adb shell pm path moe.shizuku.privileged.api | sed 's/package://; s/base.apk//' | tr -d '\\r')",
  '   adb shell "${DIR}lib/arm64/libshizuku.so"',
  '   ```',
  '3. In Relay on the receiver, tap **Shizuku: concedi il permesso** and allow it in Shizuku\'s dialog.',
  '   The status card shows *Shizuku pronto*, and the remote\'s diagnostics list `Shizuku` among the executors.',
  '',
  `More in [docs/SHIZUKU.md](https://github.com/${repo}/blob/${tag}/docs/SHIZUKU.md).`,
  '',
  '</details>',
  '',
);
if (throwaway) {
  out.push(
    '> **Note:** these APKs are signed with a throwaway key generated for this build. Uninstall a previous version before installing.',
    '',
  );
}
out.push(
  previous
    ? `**Full changelog:** https://github.com/${repo}/compare/${previous}...${tag}`
    : `**Full history:** https://github.com/${repo}/commits/${tag}`,
);

console.log(out.join('\n'));
