import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

/**
 * Rendezvous relay. Deliberately dumb: it forwards opaque frames between the two
 * members of a room and knows nothing else.
 *
 * What it cannot do, by construction:
 *  - read or forge commands (the HMAC secret is derived from the pair code,
 *    which never reaches this server; only the room id does)
 *  - persist anything (no storage, no logs of payloads)
 *
 * Deploy on any small VPS behind a TLS terminator. ~40 lines of real logic is
 * the whole cost of the remote path, which is why this beats standing up WebRTC
 * signalling plus a TURN server for a use case that sends 200 bytes a minute.
 */

const PORT = Number(process.env.PORT ?? 8080);
const MAX_ROOM_MEMBERS = 2;
const IDLE_TIMEOUT_MS = 90_000;

interface Member {
  socket: WebSocket;
  role: string;
  lastSeen: number;
}

const rooms = new Map<string, Set<Member>>();

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http });

wss.on('connection', (socket, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const match = url.pathname.match(/^\/room\/([A-Za-z0-9_-]{8,64})$/);
  if (!match) {
    socket.close(4000, 'bad room');
    return;
  }

  const roomId = match[1];
  const role = url.searchParams.get('role') ?? 'unknown';
  const room = rooms.get(roomId) ?? new Set<Member>();
  rooms.set(roomId, room);

  if (room.size >= MAX_ROOM_MEMBERS) {
    socket.close(4001, 'room full');
    return;
  }

  const member: Member = { socket, role, lastSeen: Date.now() };
  room.add(member);
  console.log(`[relay] ${role} joined ${roomId} (${room.size}/${MAX_ROOM_MEMBERS})`);

  socket.on('message', (data, isBinary) => {
    member.lastSeen = Date.now();
    for (const peer of room) {
      if (peer === member) continue;
      if (peer.socket.readyState === WebSocket.OPEN) {
        peer.socket.send(data, { binary: isBinary });
      }
    }
  });

  socket.on('pong', () => {
    member.lastSeen = Date.now();
  });

  socket.on('close', () => {
    room.delete(member);
    if (room.size === 0) rooms.delete(roomId);
    console.log(`[relay] ${role} left ${roomId}`);
  });
});

// Drop members that stopped responding, so a dead mobile socket does not hold a
// room slot and lock out the reconnecting device.
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    for (const member of room) {
      if (now - member.lastSeen > IDLE_TIMEOUT_MS) {
        member.socket.terminate();
        room.delete(member);
      } else {
        member.socket.ping();
      }
    }
    if (room.size === 0) rooms.delete(roomId);
  }
}, 30_000);

http.listen(PORT, () => console.log(`[relay] listening on :${PORT}`));
