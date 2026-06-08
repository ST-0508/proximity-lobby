const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const WORLD = { width: 1800, height: 1100 };
const HEARING_RADIUS = 210;
const PLAYER_TTL_MS = 30_000;
const CHAT_TTL_MS = 7_000;
const STATE_BROADCAST_MS = 100;

const clients = new Map();
const players = new Map();
let chats = [];
let stateBroadcastTimer = null;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function safeText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? value : "#3f7cff";
}

function safeOption(value, allowed, fallback) {
  const text = safeText(value, 24);
  return allowed.includes(text) ? text : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function createPlayer(data) {
  const id = crypto.randomUUID();
  const spawn = {
    x: Math.round(WORLD.width / 2 + (Math.random() - 0.5) * 260),
    y: Math.round(WORLD.height / 2 + (Math.random() - 0.5) * 180)
  };

  const player = {
    id,
    name: safeText(data.name, 24) || "Guest",
    color: safeColor(data.color),
    face: safeText(data.face, 2) || "🙂",
    accessory: safeText(data.accessory, 4),
    badge: safeText(data.badge, 2) || "✦",
    shape: safeOption(data.shape, ["circle", "square", "diamond"], "circle"),
    x: spawn.x,
    y: spawn.y,
    direction: "down",
    lastSeen: Date.now()
  };

  players.set(id, player);
  broadcastState();
  return player;
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    face: player.face,
    accessory: player.accessory,
    badge: player.badge,
    shape: player.shape,
    x: player.x,
    y: player.y,
    direction: player.direction
  };
}

function stateFor(clientId) {
  const player = players.get(clientId);
  const nearbyIds = new Set();

  if (player) {
    for (const other of players.values()) {
      if (other.id !== player.id && distance(player, other) <= HEARING_RADIUS) {
        nearbyIds.add(other.id);
      }
    }
  }

  return {
    selfId: clientId,
    world: WORLD,
    hearingRadius: HEARING_RADIUS,
    players: Array.from(players.values()).map(publicPlayer),
    nearbyIds: Array.from(nearbyIds),
    serverTime: Date.now()
  };
}

function sendEvent(res, type, data) {
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sendTo(clientId, type, data) {
  const res = clients.get(clientId);
  if (res) sendEvent(res, type, data);
}

function broadcastState() {
  if (stateBroadcastTimer) {
    clearTimeout(stateBroadcastTimer);
    stateBroadcastTimer = null;
  }
  for (const id of clients.keys()) {
    sendTo(id, "state", stateFor(id));
  }
}

function scheduleStateBroadcast() {
  if (stateBroadcastTimer) return;
  stateBroadcastTimer = setTimeout(broadcastState, STATE_BROADCAST_MS);
}

function broadcastChat(sender, text) {
  const chat = {
    id: crypto.randomUUID(),
    fromId: sender.id,
    fromName: sender.name,
    text,
    x: sender.x,
    y: sender.y,
    at: Date.now()
  };

  chats.push(chat);
  chats = chats.filter((item) => Date.now() - item.at < CHAT_TTL_MS);

  for (const [id] of clients) {
    const receiver = players.get(id);
    if (receiver && distance(sender, receiver) <= HEARING_RADIUS) {
      sendTo(id, "chat", chat);
    }
  }
}

function removePlayer(id) {
  clients.delete(id);
  if (players.delete(id)) {
    broadcastState();
  }
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    json(res, 200, {
      ok: true,
      players: players.size
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    json(res, 200, {});
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/join") {
    const player = createPlayer(await readBody(req));
    json(res, 200, { player: publicPlayer(player), world: WORLD, hearingRadius: HEARING_RADIUS });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/move") {
    const data = await readBody(req);
    const player = players.get(String(data.id || ""));
    if (!player) {
      json(res, 404, { error: "Player not found" });
      return true;
    }

    player.x = clamp(data.x, 24, WORLD.width - 24);
    player.y = clamp(data.y, 24, WORLD.height - 24);
    player.direction = safeText(data.direction, 8) || player.direction;
    player.lastSeen = Date.now();
    json(res, 200, { ok: true });
    scheduleStateBroadcast();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    const data = await readBody(req);
    const player = players.get(String(data.id || ""));
    const text = safeText(data.text, 180);
    if (!player || !text) {
      json(res, 400, { error: "Missing player or message" });
      return true;
    }

    player.lastSeen = Date.now();
    broadcastChat(player, text);
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    const id = String(url.searchParams.get("id") || "");
    if (!players.has(id)) {
      json(res, 404, { error: "Player not found" });
      return true;
    }

    req.socket.setTimeout(0);
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });
    clients.set(id, res);
    sendEvent(res, "state", stateFor(id));

    req.on("close", () => {
      clients.delete(id);
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/leave") {
    const data = await readBody(req);
    removePlayer(String(data.id || ""));
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname.startsWith("/api/") && (await handleApi(req, res, url))) {
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    json(res, 500, { error: error.message || "Server error" });
  }
});

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const player of players.values()) {
    if (!clients.has(player.id) && now - player.lastSeen > PLAYER_TTL_MS) {
      players.delete(player.id);
      changed = true;
    }
  }
  if (changed) broadcastState();
}, 5_000);

server.listen(PORT, HOST, () => {
  console.log(`Virtual lobby running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`Listening on ${HOST}:${PORT}`);
});
