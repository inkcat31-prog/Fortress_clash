'use strict';
const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');
const PORT = Number(process.env.PORT || 3000);
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('FORTRESS CLASH Beta 2.4 multiplayer server is running.\n');
});
const wss = new WebSocket.Server({ server, maxPayload: 1024 * 1024 });
const rooms = new Map();
const sockets = new WeakMap();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function makeCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}
function leave(ws) {
  const info = sockets.get(ws);
  if (!info) return;
  sockets.delete(ws);
  const room = rooms.get(info.room);
  if (!room) return;
  if (info.role === 'host') {
    send(room.guest, { type: 'error', message: 'Власник кімнати від’єднався; кімната закрита.' });
    if (room.guest) sockets.delete(room.guest);
    rooms.delete(info.room);
  } else if (info.role === 'guest') {
    room.guest = null;
    send(room.host, { type: 'peerLeft' });
  }
}
wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { send(ws, { type: 'error', message: 'Некоректне повідомлення.' }); return; }
    const info = sockets.get(ws);
    if (msg.type === 'create') {
      if (info) { send(ws, { type: 'error', message: 'Це з’єднання вже прив’язане до кімнати.' }); return; }
      const code = makeCode();
      rooms.set(code, { host: ws, guest: null, state: null });
      sockets.set(ws, { room: code, role: 'host' });
      send(ws, { type: 'created', room: code });
      return;
    }
    if (msg.type === 'join') {
      if (info) { send(ws, { type: 'error', message: 'Це з’єднання вже прив’язане до кімнати.' }); return; }
      const code = String(msg.room || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) { send(ws, { type: 'error', message: 'Кімнату не знайдено. Перевір код.' }); return; }
      if (room.guest) { send(ws, { type: 'error', message: 'У цій кімнаті вже є два гравці.' }); return; }
      room.guest = ws;
      sockets.set(ws, { room: code, role: 'guest' });
      send(ws, { type: 'joined', room: code, state: room.state });
      send(room.host, { type: 'peerJoined' });
      if (room.state) send(ws, { type: 'state', state: room.state });
      return;
    }
    if (!info) { send(ws, { type: 'error', message: 'Спочатку створи кімнату або приєднайся до неї.' }); return; }
    const room = rooms.get(info.room);
    if (!room) { send(ws, { type: 'error', message: 'Кімната вже закрита.' }); return; }
    if (msg.type === 'state' && info.role === 'host' && msg.state && typeof msg.state === 'object') {
      room.state = msg.state;
      send(room.guest, { type: 'state', state: room.state });
    } else if (msg.type === 'command' && info.role === 'guest') {
      // Accept the client payload as either {type:'command', command:{...}} or
      // the compact {type:'command', action:'...', ...} shape.
      const command = msg.command && typeof msg.command === 'object'
        ? msg.command
        : Object.fromEntries(Object.entries(msg).filter(([key]) => key !== 'type'));
      if (!command.action) { send(ws, { type: 'error', message: 'Команда не містить дії.' }); return; }
      // The host client remains authoritative for the actual game state and validates actions.
      send(room.host, { type: 'remoteCommand', command });
    } else {
      send(ws, { type: 'error', message: 'Непідтримувана дія.' });
    }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});
server.listen(PORT, '0.0.0.0', () => console.log(`FORTRESS CLASH server listening on ${PORT}`));
