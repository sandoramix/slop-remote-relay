import type { Transport, TransportEvents } from '@relay/protocol';
import { httpBase, randomId, RoomOptions } from './common';

export interface RelayHttpOptions extends RoomOptions {
  /** The relay's URL; ws(s):// is rewritten to http(s):// on the same host. */
  url: string;
  /** How long the relay holds a poll open when there is nothing to deliver. */
  holdMs?: number;
  connectTimeoutMs?: number;
}

/**
 * Remote relay over plain HTTP: long-poll to receive, POST to send.
 *
 * For networks that break WebSockets — corporate proxies, captive portals,
 * some hotel and carrier middleboxes that only pass request/response HTTP. It
 * is slower than the WebSocket path (a POST per frame, a reopened poll after
 * each delivery) and it is meant to be: it only carries traffic when the
 * better paths are gone.
 *
 * Long-poll rather than Server-Sent Events because React Native has no
 * EventSource, and a fetch that simply waits works everywhere.
 */
export class RelayHttpTransport implements Transport {
  readonly id = 'http';
  readonly label = 'Relay HTTP';
  readonly priority: number;
  readonly worksRemotely = true;

  /** Identifies this member to the relay across polls, so it keeps one queue. */
  private readonly sid = randomId();
  private abort: AbortController | null = null;
  private running = false;

  constructor(private readonly options: RelayHttpOptions) {
    this.priority = options.priority ?? 12;
  }

  private endpoint(action: 'poll' | 'send'): string {
    const { url, room, role } = this.options;
    return `${httpBase(url)}/room/${encodeURIComponent(room)}/${action}?role=${role}&sid=${this.sid}`;
  }

  async connect(events: TransportEvents): Promise<void> {
    const { connectTimeoutMs = 6000, holdMs = 25_000 } = this.options;

    // First poll with hold=0: registers the member and proves the relay is
    // reachable over HTTP, without waiting out a whole hold period.
    const first = await this.poll(0, connectTimeoutMs);
    first.forEach((f) => events.onMessage(f));
    this.running = true;
    events.onStateChange('connected');

    void (async () => {
      while (this.running) {
        try {
          const frames = await this.poll(holdMs, holdMs + 10_000);
          if (!this.running) return;
          frames.forEach((f) => events.onMessage(f));
        } catch (error) {
          if (!this.running) return;
          this.running = false;
          events.onStateChange('failed', `http poll: ${(error as Error).message}`);
          return;
        }
      }
    })();
  }

  private async poll(holdMs: number, timeoutMs: number): Promise<string[]> {
    const abort = new AbortController();
    this.abort = abort;
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.endpoint('poll')}&hold=${holdMs}`, {
        signal: abort.signal,
        headers: { 'cache-control': 'no-cache' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { frames?: string[] };
      return Array.isArray(body.frames) ? body.frames : [];
    } finally {
      clearTimeout(timer);
    }
  }

  async send(raw: string): Promise<void> {
    if (!this.running) throw new Error('HTTP relay not connected');
    const res = await fetch(this.endpoint('send'), {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: raw,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async close(): Promise<void> {
    this.running = false;
    this.abort?.abort();
    this.abort = null;
  }
}
