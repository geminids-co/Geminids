/**
 * ============================================================================
 * GEMINIDS — REAL-TIME TRANSMISSION SERVER
 * Node.js WebSocket broadcast server (built on `ws` + `better-sqlite3`)
 * ============================================================================
 *
 * Responsibilities:
 *   - Accept WebSocket connections from Geminids clients.
 *   - Track connected clients (declared user ID + sector) and maintain a
 *     presence roster per sector, broadcast on join/switch/disconnect.
 *   - Broadcast every incoming transmission to all clients in the SAME
 *     sector, and persist it to a local SQLite database so history
 *     survives restarts and reconnects.
 *   - Send the last N transmissions for a sector to a client the moment
 *     they join or switch into it, so the log isn't empty on arrival.
 *   - Maintain one pinned "standing notice" per sector — moderator-only.
 *   - Support moderator-only soft-delete (message body replaced with a
 *     redaction marker, never removed from the database — the log stays
 *     an honest record, not a silently edited one).
 *   - Rate-limit transmissions per connection (sliding window) so one
 *     observer can't flood a sector.
 *   - Heartbeat clients so dead connections get pruned instead of
 *     leaking memory.
 *   - Run behind a plain HTTP server for host health checks.
 *
 * Run locally:
 *   npm install
 *   npm start
 *
 * Environment variables:
 *   PORT                     — port to listen on (default 8080)
 *   MAX_MESSAGE_LENGTH       — max transmission body length (default 480)
 *   HEARTBEAT_INTERVAL_MS    — ping interval in ms (default 30000)
 *   MAX_CONNECTIONS_PER_IP   — basic per-IP connection cap (default 20)
 *   MODERATOR_KEY            — shared secret; a client that presents this
 *                              on join gets pin/delete privileges. Set a
 *                              real value in production — if unset, NO ONE
 *                              gets moderator rights (safe default).
 *   DB_PATH                  — SQLite file path (default ./geminids.db)
 *   RATE_LIMIT_MAX           — max transmissions per window (default 5)
 *   RATE_LIMIT_WINDOW_MS     — rate limit window in ms (default 10000)
 *   HISTORY_LIMIT            — messages sent on join/switch (default 50)
 * ============================================================================
 */

'use strict';

const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const Database = require('better-sqlite3');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 8080;
const MAX_MESSAGE_LENGTH = Number(process.env.MAX_MESSAGE_LENGTH) || 480;
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS) || 30000;
const MAX_CONNECTIONS_PER_IP = Number(process.env.MAX_CONNECTIONS_PER_IP) || 20;
const MODERATOR_KEY = process.env.MODERATOR_KEY || null;
const DB_PATH = process.env.DB_PATH || './geminids.db';
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 5;
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 10000;
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT) || 50;

// ---------------------------------------------------------------------------
// Database — SQLite via better-sqlite3 (synchronous, no separate DB server
// to run, fine for a community-scale chat). One file on disk; back it up
// like any other file if you care about the log surviving a host wipe.
// ---------------------------------------------------------------------------
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL'); // safer + faster under concurrent writes

db.exec(`
  CREATE TABLE IF NOT EXISTS transmissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sector TEXT NOT NULL,
    user_id TEXT NOT NULL,
    body TEXT NOT NULL,
    reply_to TEXT,
    timestamp TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_sector_timestamp ON transmissions (sector, timestamp);
`);

const insertMessageStmt = db.prepare(`
  INSERT INTO transmissions (sector, user_id, body, reply_to, timestamp)
  VALUES (@sector, @userId, @body, @replyTo, @timestamp)
`);

const historyStmt = db.prepare(`
  SELECT sector, user_id AS userId, body, reply_to AS replyTo, timestamp, deleted
  FROM transmissions
  WHERE sector = ?
  ORDER BY timestamp DESC
  LIMIT ?
`);

const softDeleteStmt = db.prepare(`
  UPDATE transmissions SET deleted = 1
  WHERE sector = ? AND user_id = ? AND timestamp = ?
`);

function persistMessage(message) {
  insertMessageStmt.run({
    sector: message.sector,
    userId: message.userId,
    body: message.body,
    replyTo: message.replyTo ? JSON.stringify(message.replyTo) : null,
    timestamp: message.timestamp,
  });
}

function getHistory(sector, limit = HISTORY_LIMIT) {
  const rows = historyStmt.all(sector, limit);
  return rows.reverse().map((row) => ({
    type: 'transmission',
    sector: row.sector,
    userId: row.userId,
    body: row.deleted ? '[TRANSMISSION REDACTED BY MODERATOR]' : row.body,
    replyTo: row.replyTo ? JSON.parse(row.replyTo) : null,
    timestamp: row.timestamp,
    deleted: !!row.deleted,
  }));
}

// ---------------------------------------------------------------------------
// HTTP server — health check + hosting platform requirement
// ---------------------------------------------------------------------------
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'OK',
      service: 'geminids-transmission-server',
      clients: wss ? wss.clients.size : 0,
      uptimeSeconds: process.uptime(),
    }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('NOT FOUND');
});

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------
const wss = new WebSocket.Server({
  server: httpServer,
  maxPayload: 64 * 1024,
});

const ipConnectionCounts = new Map();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress;
}

function broadcast(payload, exclude = null) {
  const data = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client !== exclude) {
      client.send(data, (err) => {
        if (err) console.error('[geminids] send error:', err.message);
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Sector-scoped state — presence rosters and one pinned notice per sector.
// ---------------------------------------------------------------------------
const sectorMembers = new Map(); // sector -> Map<socket.id, userId>
const pinnedBySector = new Map(); // sector -> pinned message object | null

function broadcastToSector(sector, payload, exclude = null) {
  const data = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client !== exclude && client.sector === sector) {
      client.send(data, (err) => {
        if (err) console.error('[geminids] send error:', err.message);
      });
    }
  });
}

function getRoster(sector) {
  const members = sectorMembers.get(sector);
  return members ? Array.from(members.values()) : [];
}

function broadcastPresence(sector) {
  broadcastToSector(sector, {
    type: 'presence',
    sector,
    observers: getRoster(sector),
    count: getRoster(sector).length,
  });
}

function joinSector(socket, sector, userId) {
  if (!sectorMembers.has(sector)) sectorMembers.set(sector, new Map());
  sectorMembers.get(sector).set(socket.id, userId);
  broadcastPresence(sector);
}

function leaveSector(socket, sector) {
  if (!sector || !sectorMembers.has(sector)) return;
  sectorMembers.get(sector).delete(socket.id);
  if (sectorMembers.get(sector).size === 0) sectorMembers.delete(sector);
  else broadcastPresence(sector);
}

function systemMessage(body) {
  return { type: 'system', body, timestamp: new Date().toISOString() };
}

function sanitizeText(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, MAX_MESSAGE_LENGTH);
}

function isValidSector(sector) {
  return typeof sector === 'string' && /^[A-Z0-9_]{1,32}$/.test(sector);
}

function isValidUserId(userId) {
  return typeof userId === 'string' && /^[A-Z0-9_]{1,32}$/.test(userId);
}

// ---------------------------------------------------------------------------
// Rate limiting — simple sliding window per connection. Tracks recent
// transmission timestamps in memory; not persisted, resets on reconnect.
// ---------------------------------------------------------------------------
function isRateLimited(socket) {
  const now = Date.now();
  socket.recentSendTimes = (socket.recentSendTimes || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (socket.recentSendTimes.length >= RATE_LIMIT_MAX) return true;
  socket.recentSendTimes.push(now);
  return false;
}

wss.on('connection', (socket, req) => {
  const ip = getClientIp(req);
  const count = (ipConnectionCounts.get(ip) || 0) + 1;
  ipConnectionCounts.set(ip, count);

  if (count > MAX_CONNECTIONS_PER_IP) {
    socket.close(1008, 'TOO MANY CONNECTIONS FROM THIS ADDRESS');
    ipConnectionCounts.set(ip, count - 1);
    return;
  }

  socket.id = crypto.randomUUID();
  socket.isAlive = true;
  socket.userId = null;
  socket.sector = null;
  socket.ip = ip;
  socket.isModerator = false;
  socket.recentSendTimes = [];

  console.log(`[geminids] connection opened — id=${socket.id} ip=${ip} clients=${wss.clients.size}`);

  socket.on('pong', () => { socket.isAlive = true; });

  socket.on('message', (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch (err) {
      socket.send(JSON.stringify(systemMessage('MALFORMED PAYLOAD — TRANSMISSION REJECTED')));
      return;
    }

    if (!payload || typeof payload.type !== 'string') {
      socket.send(JSON.stringify(systemMessage('UNKNOWN PAYLOAD SHAPE — TRANSMISSION REJECTED')));
      return;
    }

    switch (payload.type) {
      case 'join': {
        const userId = isValidUserId(payload.userId) ? payload.userId : `OBS_${socket.id.slice(0, 5).toUpperCase()}`;
        const sector = isValidSector(payload.sector) ? payload.sector : 'SECTOR_04';
        socket.userId = userId;
        socket.sector = sector;

        // Moderator status: granted only if MODERATOR_KEY is configured on
        // the server AND the client presented a matching key. If the env
        // var is unset, nobody is ever a moderator — safe by default.
        socket.isModerator = Boolean(MODERATOR_KEY) && payload.modKey === MODERATOR_KEY;

        joinSector(socket, sector, userId);
        broadcastToSector(sector, systemMessage(`${userId} JOINED ${sector}`));

        socket.send(JSON.stringify({ type: 'mod_status', isModerator: socket.isModerator }));
        socket.send(JSON.stringify({ type: 'history', sector, messages: getHistory(sector) }));

        const pinned = pinnedBySector.get(sector);
        if (pinned) socket.send(JSON.stringify({ type: 'pinned_update', sector, message: pinned }));
        break;
      }

      case 'switch_sector': {
        const nextSector = isValidSector(payload.sector) ? payload.sector : 'SECTOR_04';
        const prevSector = socket.sector;
        if (prevSector === nextSector) break;

        if (prevSector) leaveSector(socket, prevSector);
        socket.sector = nextSector;
        joinSector(socket, nextSector, socket.userId || 'OBSERVER');

        socket.send(JSON.stringify({ type: 'history', sector: nextSector, messages: getHistory(nextSector) }));

        const pinned = pinnedBySector.get(nextSector);
        socket.send(JSON.stringify({ type: 'pinned_update', sector: nextSector, message: pinned || null }));
        break;
      }

      case 'transmission': {
        const body = sanitizeText(payload.body);
        if (!body) return;

        if (isRateLimited(socket)) {
          socket.send(JSON.stringify(systemMessage('TRANSMISSION THROTTLED — SLOW DOWN AND RETRY')));
          return;
        }

        const sector = isValidSector(payload.sector) ? payload.sector : (socket.sector || 'SECTOR_04');
        const userId = socket.userId || (isValidUserId(payload.userId) ? payload.userId : `OBS_${socket.id.slice(0, 5).toUpperCase()}`);

        let replyTo = null;
        if (payload.replyTo && typeof payload.replyTo === 'object') {
          replyTo = {
            userId: isValidUserId(payload.replyTo.userId) ? payload.replyTo.userId : null,
            timestamp: typeof payload.replyTo.timestamp === 'string' ? payload.replyTo.timestamp : null,
            snippet: sanitizeText(payload.replyTo.snippet || '').slice(0, 80),
          };
        }

        const message = {
          type: 'transmission',
          userId,
          sector,
          body,
          replyTo,
          timestamp: new Date().toISOString(),
        };

        persistMessage(message);
        broadcastToSector(sector, message);
        break;
      }

      case 'pin': {
        if (!socket.isModerator) {
          socket.send(JSON.stringify(systemMessage('PIN REJECTED — MODERATOR PRIVILEGES REQUIRED')));
          return;
        }
        const sector = isValidSector(payload.sector) ? payload.sector : (socket.sector || 'SECTOR_04');
        const timestamp = typeof payload.timestamp === 'string' ? payload.timestamp : null;
        const userId = isValidUserId(payload.userId) ? payload.userId : null;
        const body = sanitizeText(payload.body || '');
        if (!timestamp || !userId || !body) return;

        const current = pinnedBySector.get(sector);
        const isSameMessage = current && current.timestamp === timestamp && current.userId === userId;
        const next = isSameMessage ? null : { userId, timestamp, body };
        pinnedBySector.set(sector, next);
        broadcastToSector(sector, { type: 'pinned_update', sector, message: next });
        break;
      }

      case 'delete': {
        if (!socket.isModerator) {
          socket.send(JSON.stringify(systemMessage('DELETE REJECTED — MODERATOR PRIVILEGES REQUIRED')));
          return;
        }
        const sector = isValidSector(payload.sector) ? payload.sector : (socket.sector || 'SECTOR_04');
        const timestamp = typeof payload.timestamp === 'string' ? payload.timestamp : null;
        const userId = isValidUserId(payload.userId) ? payload.userId : null;
        if (!timestamp || !userId) return;

        softDeleteStmt.run(sector, userId, timestamp);
        broadcastToSector(sector, { type: 'deleted', sector, userId, timestamp });
        break;
      }

      default:
        socket.send(JSON.stringify(systemMessage(`UNRECOGNIZED TRANSMISSION TYPE: ${payload.type}`)));
    }
  });

  socket.on('close', () => {
    const remaining = (ipConnectionCounts.get(ip) || 1) - 1;
    if (remaining <= 0) ipConnectionCounts.delete(ip);
    else ipConnectionCounts.set(ip, remaining);

    console.log(`[geminids] connection closed — id=${socket.id} clients=${wss.clients.size - 1}`);
    if (socket.sector) leaveSector(socket, socket.sector);
    if (socket.userId && socket.sector) {
      broadcastToSector(socket.sector, systemMessage(`${socket.userId} DISCONNECTED`));
    }
  });

  socket.on('error', (err) => {
    console.error(`[geminids] socket error — id=${socket.id}:`, err.message);
  });
});

// ---------------------------------------------------------------------------
// Heartbeat sweep
// ---------------------------------------------------------------------------
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((socket) => {
    if (socket.isAlive === false) {
      console.log(`[geminids] terminating unresponsive connection — id=${socket.id}`);
      return socket.terminate();
    }
    socket.isAlive = false;
    socket.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

wss.on('close', () => clearInterval(heartbeatInterval));

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
wss.on('error', (err) => console.error('[geminids] WebSocket server error:', err));
httpServer.on('error', (err) => { console.error('[geminids] HTTP server error:', err); process.exit(1); });
process.on('uncaughtException', (err) => console.error('[geminids] uncaught exception:', err));
process.on('unhandledRejection', (reason) => console.error('[geminids] unhandled rejection:', reason));

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown(signal) {
  console.log(`[geminids] received ${signal}, shutting down gracefully...`);
  clearInterval(heartbeatInterval);
  broadcast(systemMessage('SERVER SHUTTING DOWN — CONNECTION WILL DROP'));
  wss.clients.forEach((socket) => socket.close(1001, 'SERVER SHUTTING DOWN'));
  wss.close(() => {
    httpServer.close(() => {
      db.close();
      console.log('[geminids] shutdown complete.');
      process.exit(0);
    });
  });
  setTimeout(() => {
    console.warn('[geminids] forced shutdown after timeout.');
    process.exit(1);
  }, 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
httpServer.listen(PORT, () => {
  console.log(`[geminids] transmission server listening on port ${PORT}`);
  console.log(`[geminids] database at ${DB_PATH}`);
  console.log(`[geminids] moderator key ${MODERATOR_KEY ? 'CONFIGURED' : 'NOT SET — no moderators active'}`);
  console.log(`[geminids] health check available at http://localhost:${PORT}/health`);
});
