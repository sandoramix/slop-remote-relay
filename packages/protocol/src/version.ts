/**
 * Release versions and the GitHub release they come from. Shared by the
 * controller and the browser extension; the Kotlin receiver has its own copy
 * in update/UpdateChecker.kt.
 */

/** Where releases are published. */
export const RELEASES_REPO = 'sandoramix/slop-remote-relay';
export const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;

/**
 * Compares two versions like "0.2.1" or "v1.10.0". Returns a negative number
 * when a < b, zero when equal, positive when a > b. Anything after a dash
 * (a pre-release tag) makes a version lower than the same version without one.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = '', pre] = v.trim().replace(/^v/i, '').split('-', 2);
    return { parts: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.parts.length, y.parts.length, 3); i++) {
    const d = (x.parts[i] ?? 0) - (y.parts[i] ?? 0);
    if (d !== 0) return d;
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface LatestRelease {
  version: string;
  tag: string;
  pageUrl: string;
  /** Release notes, markdown. */
  notes: string;
  publishedAt: string;
  assets: ReleaseAsset[];
  /**
   * Worth insisting on: the notes flag a breaking change or a security fix.
   * The update is still never forced.
   */
  important: boolean;
}

/** Shapes the GitHub API response into what the update prompts need. */
export function parseRelease(json: {
  tag_name: string;
  html_url: string;
  body?: string | null;
  published_at: string;
  assets?: Array<{ name: string; browser_download_url: string; size: number }>;
}): LatestRelease {
  const notes = json.body ?? '';
  return {
    version: json.tag_name.replace(/^v/i, ''),
    tag: json.tag_name,
    pageUrl: json.html_url,
    notes,
    publishedAt: json.published_at,
    assets: (json.assets ?? []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
    important: /\bBREAKING\b|security|sicurezza/i.test(notes),
  };
}

/**
 * A few bullet points for a compact prompt, without markdown: the release's
 * hand-written highlights when it has them, otherwise the first lines of the
 * generated changelog.
 */
export function releaseSummary(notes: string, maxLines = 4): string[] {
  const section = (title: string): string | null => {
    const start = notes.indexOf(title);
    if (start < 0) return null;
    const rest = notes.slice(start + title.length);
    const end = rest.search(/\n## /);
    return end >= 0 ? rest.slice(0, end) : rest;
  };
  const body = section('## Highlights') ?? section("## What's changed") ?? '';
  // A bullet wraps onto indented lines; join them back into one item.
  const items: string[] = [];
  let open = false;
  for (const line of body.split('\n')) {
    if (line.startsWith('- ')) {
      items.push(line.trim());
      open = true;
    } else if (open && /^\s+\S/.test(line)) {
      items[items.length - 1] += ` ${line.trim()}`;
    } else {
      open = false;
    }
  }
  return items
    .map((l) =>
      l
        .slice(2)
        .replace(/\*\*/g, '')
        .replace(/`/g, '')
        .replace(/\s\([0-9a-f]{7}\)$/, ''),
    )
    .slice(0, maxLines);
}
