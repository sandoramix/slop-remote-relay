import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

/**
 * Rendezvous relay. Deliberately dumb: it forwards opaque frames between the
 * members of a room and knows nothing else.
 *
 * What it cannot do, by construction:
 *  - read or forge commands (the HMAC secret is derived from the pair code,
 *    which never reaches this server; only the room id does)
 *  - persist anything (no storage, no logs of payloads)
 *
 * Two channels reach a room, and a member is one (role, channel) pair:
 *  - `ws`:   a WebSocket at /room/<id>?role=<role>&ch=ws
 *  - `http`: long-poll GET /room/<id>/poll and POST /room/<id>/send, for
 *            networks that break WebSockets
 *
 * A frame goes to the peer's member on the same channel when it has one, and to
 * every peer member otherwise. Same-channel delivery keeps the WebSocket and
 * HTTP paths independent — a heartbeat on one proves that path, not the other —
 * while the fallback means a controller on HTTP still reaches a receiver that
 * only managed a WebSocket. Duplicates are harmless: both ends dedupe on id.
 *
 * WebRTC signalling uses the same machinery in a sibling room (<id>-rtc).
 */

const PORT = Number(process.env.PORT ?? 8080);
const IDLE_TIMEOUT_MS = 90_000;
/** An HTTP member that has not polled for this long is gone. */
const HTTP_MEMBER_TTL_MS = 60_000;
const MAX_HOLD_MS = 30_000;
const MAX_QUEUE = 64;
const MAX_FRAME_BYTES = 16 * 1024;
const ROOM_RE = /^[A-Za-z0-9_-]{8,64}$/;

type Channel = 'ws' | 'http';

interface Member {
  role: string;
  channel: Channel;
  lastSeen: number;
  deliver(frame: string): void;
  close(): void;
}

class WsMember implements Member {
  readonly channel = 'ws' as const;
  lastSeen = Date.now();
  constructor(
    readonly role: string,
    readonly socket: WebSocket,
  ) {}
  deliver(frame: string): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(frame);
  }
  close(): void {
    this.socket.terminate();
  }
}

class HttpMember implements Member {
  readonly channel = 'http' as const;
  lastSeen = Date.now();
  private queue: string[] = [];
  private waiter: ((frames: string[]) => void) | null = null;

  constructor(
    readonly role: string,
    readonly sid: string,
  ) {}

  deliver(frame: string): void {
    this.queue.push(frame);
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
    this.flush();
  }

  /** Resolves with queued frames now, or when one arrives, or after holdMs. */
  wait(holdMs: number): Promise<string[]> {
    this.lastSeen = Date.now();
    this.waiter?.([]); // a newer poll supersedes an older one
    if (this.queue.length || holdMs <= 0) return Promise.resolve(this.drain());
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.waiter === done) this.waiter = null;
        resolve(this.drain());
      }, holdMs);
      const done = (frames: string[]) => {
        clearTimeout(timer);
        resolve(frames);
      };
      this.waiter = done;
    });
  }

  private flush(): void {
    const waiter = this.waiter;
    if (!waiter) return;
    this.waiter = null;
    waiter(this.drain());
  }

  private drain(): string[] {
    const frames = this.queue;
    this.queue = [];
    return frames;
  }

  close(): void {
    this.waiter?.([]);
    this.waiter = null;
  }
}

const rooms = new Map<string, Map<string, Member>>();

const keyOf = (role: string, channel: Channel) => `${role}:${channel}`;

function join(roomId: string, member: Member): void {
  const room = rooms.get(roomId) ?? new Map<string, Member>();
  rooms.set(roomId, room);
  const key = keyOf(member.role, member.channel);
  // A reconnecting device replaces its own stale slot instead of being locked
  // out by it — the old "room full" failure after a mobile socket died.
  const previous = room.get(key);
  if (previous && previous !== member) previous.close();
  room.set(key, member);
  console.log(`[relay] ${key} joined ${roomId} (${room.size} members)`);
}

function leave(roomId: string, member: Member): void {
  const room = rooms.get(roomId);
  if (!room) return;
  const key = keyOf(member.role, member.channel);
  if (room.get(key) === member) {
    room.delete(key);
    console.log(`[relay] ${key} left ${roomId}`);
  }
  if (room.size === 0) rooms.delete(roomId);
}

function forward(roomId: string, from: Member, frame: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  from.lastSeen = Date.now();
  const peers = [...room.values()].filter((m) => m.role !== from.role);
  const sameChannel = peers.filter((m) => m.channel === from.channel);
  for (const peer of sameChannel.length ? sameChannel : peers) peer.deliver(frame);
}

// ------------------------------------------------------------------- HTTP

function send(res: ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    // The browser extension and any web client call this cross-origin.
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, cache-control',
  });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_FRAME_BYTES) {
        reject(new Error('frame too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function httpMember(roomId: string, role: string, sid: string): HttpMember {
  const existing = rooms.get(roomId)?.get(keyOf(role, 'http'));
  if (existing instanceof HttpMember && existing.sid === sid) return existing;
  const member = new HttpMember(role, sid);
  join(roomId, member);
  return member;
}

const http = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);

  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') {
    return send(res, 200, { ok: true, rooms: rooms.size });
  }

  const match = url.pathname.match(/^\/room\/([^/]+)\/(poll|send)$/);
  if (!match || !ROOM_RE.test(match[1]!)) return send(res, 404, { error: 'not found' });
  const [, roomId, action] = match as unknown as [string, string, 'poll' | 'send'];
  const role = url.searchParams.get('role') ?? 'unknown';
  const sid = url.searchParams.get('sid') ?? '';
  if (!/^[A-Za-z0-9]{4,64}$/.test(sid)) return send(res, 400, { error: 'bad sid' });

  const member = httpMember(roomId, role, sid);

  if (action === 'poll' && req.method === 'GET') {
    const hold = Math.min(Number(url.searchParams.get('hold') ?? 0) || 0, MAX_HOLD_MS);
    let gone = false;
    req.on('close', () => {
      gone = true;
    });
    const frames = await member.wait(hold);
    if (gone) {
      // The client went away mid-hold; put the frames back for its next poll.
      frames.forEach((f) => member.deliver(f));
      return;
    }
    return send(res, 200, { frames });
  }

  if (action === 'send' && req.method === 'POST') {
    try {
      const frame = await readBody(req);
      forward(roomId, member, frame);
      member.lastSeen = Date.now();
      return send(res, 202, { ok: true });
    } catch (error) {
      return send(res, 413, { error: (error as Error).message });
    }
  }

  return send(res, 405, { error: 'method not allowed' });
});

// -------------------------------------------------------------- WebSocket

const wss = new WebSocketServer({ server: http, maxPayload: MAX_FRAME_BYTES });

wss.on('connection', (socket, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const match = url.pathname.match(/^\/room\/([^/]+)$/);
  if (!match || !ROOM_RE.test(match[1]!)) {
    socket.close(4000, 'bad room');
    return;
  }

  const roomId = match[1]!;
  const role = url.searchParams.get('role') ?? 'unknown';
  const member = new WsMember(role, socket);
  join(roomId, member);

  socket.on('message', (data) => forward(roomId, member, data.toString()));
  socket.on('pong', () => {
    member.lastSeen = Date.now();
  });
  socket.on('close', () => leave(roomId, member));
});

// Drop members that stopped responding, so a dead mobile socket or an HTTP
// client that vanished does not linger and swallow frames meant for its peer.
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    for (const member of room.values()) {
      const ttl = member.channel === 'http' ? HTTP_MEMBER_TTL_MS : IDLE_TIMEOUT_MS;
      if (now - member.lastSeen > ttl) {
        member.close();
        leave(roomId, member);
      } else if (member instanceof WsMember) {
        member.socket.ping();
      }
    }
  }
}, 15_000);

http.listen(PORT, () => console.log(`[relay] listening on :${PORT}`));
