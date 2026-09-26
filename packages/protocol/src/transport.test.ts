/**
 * TransportManager behaviour with fake transports: the user's order decides,
 * the first seconds settle on the best path, failover is instant and promotion
 * back up is slow.
 *
 *   npm test -w @relay/protocol
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TransportManager, type Transport, type TransportEvents, type TopologySnapshot } from './transport';

class Fake implements Transport {
  readonly label: string;
  readonly worksRemotely = true;
  events: TransportEvents | null = null;
  sent: string[] = [];

  constructor(
    readonly id: string,
    readonly priority: number,
    private readonly connectDelayMs = 0,
  ) {
    this.label = id;
  }

  async connect(events: TransportEvents): Promise<void> {
    this.events = events;
    await new Promise((r) => setTimeout(r, this.connectDelayMs));
  }

  async send(raw: string): Promise<void> {
    this.sent.push(raw);
    // Answer pings so heartbeats keep the path healthy.
    const msg = JSON.parse(raw) as { type: string; nonce?: string; ts: number };
    if (msg.type === 'ping') {
      setTimeout(() => this.events?.onMessage(JSON.stringify({ ...msg, type: 'pong' })), 1);
    }
  }

  async close(): Promise<void> {}

  drop(): void {
    this.events?.onStateChange('failed', 'test drop');
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function manager(transports: Transport[], overrides: Partial<ConstructorParameters<typeof TransportManager>[2]> = {}) {
  let last: TopologySnapshot | null = null;
  const m = new TransportManager(
    transports,
    { onMessage: () => undefined, onTopologyChange: (s) => (last = s) },
    {
      heartbeatMs: 50,
      standbyProbeMs: 80,
      missTolerance: 2,
      promoteStableMs: 400,
      initialSettleMs: 300,
      maxBackoffMs: 100,
      timeoutMs: 60,
      ...overrides,
    },
  );
  return { m, active: () => last?.activeId ?? null };
}

describe('TransportManager', () => {
  it('uses the user\'s first choice even when a lower one answers first', async () => {
    const preferred = new Fake('relay', 0, 120);
    const fast = new Fake('lan', 10, 0);
    const { m, active } = manager([preferred, fast]);
    await m.start();
    await sleep(50);
    assert.equal(active(), 'relay');
    await m.stop();
  });

  it('fails over at once when the active path drops', async () => {
    const a = new Fake('a', 0);
    const b = new Fake('b', 10);
    const { m, active } = manager([a, b], { initialSettleMs: 0 });
    await m.start();
    assert.equal(active(), 'a');
    a.drop();
    assert.equal(active(), 'b');
    await m.stop();
  });

  it('waits for sustained health before moving back up', async () => {
    const a = new Fake('a', 0);
    const b = new Fake('b', 10);
    const { m, active } = manager([a, b], { initialSettleMs: 0 });
    await m.start();
    a.drop();
    assert.equal(active(), 'b');
    // `a` redials after backoff (≤100 ms) but must hold 400 ms before promotion.
    await sleep(250);
    assert.equal(active(), 'b', 'promoted too early');
    await sleep(600);
    assert.equal(active(), 'a', 'never promoted back');
    await m.stop();
  });

  it('mirrors a critical send onto the best standby', async () => {
    const a = new Fake('a', 0);
    const b = new Fake('b', 10);
    const { m } = manager([a, b]);
    await m.start();
    a.sent.length = 0;
    b.sent.length = 0;
    await m.send('{"type":"cmd"}', true);
    assert.ok(a.sent.includes('{"type":"cmd"}'));
    assert.ok(b.sent.includes('{"type":"cmd"}'));
    await m.stop();
  });
});
