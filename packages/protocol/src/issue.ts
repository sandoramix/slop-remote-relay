/**
 * A prefilled "new issue" link for the project's GitHub repository.
 *
 * No token and no server: the app opens this link and the person submits the
 * issue from their own account. The text is always English, whatever language
 * the app is in, because the developer reads it. A URL holds only about 8 KB,
 * so only the newest log lines go in; the apps also put the full report on the
 * clipboard for pasting under the "Log" heading.
 *
 * Its Kotlin twin is `core/IssueReport.kt` in the Android receiver.
 */

export const ISSUES_NEW = 'https://github.com/sandoramix/slop-remote-relay/issues/new';

/** GitHub refuses a request line past 8192 bytes; this leaves room for the host and the title. */
export const MAX_ENCODED_BODY = 6000;

/** Log lines tried first; fewer are used until the link fits. */
const MAX_LOG_LINES = 60;

export interface IssueReport {
  /** Which app, shown in the title: "controller", "receiver", "extension". */
  app: string;
  version: string;
  /** One fact per entry ("Android 14 (API 34), Xiaomi Pad6S"); no secrets. */
  details: string[];
  /** The whole log, oldest line first. */
  log: string;
}

function body(report: IssueReport, lines: string[], total: number): string {
  const shown =
    lines.length === 0
      ? '_The log is too long for this link and is on your clipboard: paste it here._'
      : `Last ${lines.length} of ${total} lines. The full log is on your clipboard: paste it below if it helps.\n\n\`\`\`\n${lines.join('\n')}\n\`\`\``;
  return [
    '**What happened?**',
    '',
    '<!-- Describe what you did and what you expected. -->',
    '',
    '',
    '**Details**',
    ...report.details.map((d) => `- ${d}`),
    '',
    '**Log**',
    shown,
  ].join('\n');
}

export function issueUrl(report: IssueReport): string {
  const all = report.log.split('\n').filter((l) => l.length > 0);
  let n = Math.min(all.length, MAX_LOG_LINES);
  let text = body(report, all.slice(all.length - n), all.length);
  // Drop the oldest lines until the encoded body fits.
  while (n > 0 && encodeURIComponent(text).length > MAX_ENCODED_BODY) {
    n = Math.max(0, n - 5);
    text = body(report, all.slice(all.length - n), all.length);
  }
  const title = `[${report.app} ${report.version}] `;
  return `${ISSUES_NEW}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`;
}
