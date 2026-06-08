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
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const SUPPORTED_LANGUAGES = {
  en: "English",
  es: "Spanish",
  ja: "Japanese",
  fr: "French"
};

const clients = new Map();
const players = new Map();
let chats = [];

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

function translationProviderName() {
  if (process.env.OPENAI_API_KEY) return `OpenAI ${OPENAI_MODEL}`;
  if (process.env.LIBRETRANSLATE_URL) return "LibreTranslate";
  return "offline phrasebook";
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
  for (const id of clients.keys()) {
    sendTo(id, "state", stateFor(id));
  }
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

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[!?.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const phrasebook = [
  { en: "hello", es: "hola", ja: "こんにちは", fr: "bonjour" },
  { en: "hi", es: "hola", ja: "やあ", fr: "salut" },
  { en: "good morning", es: "buenos dias", ja: "おはよう", fr: "bonjour" },
  { en: "good evening", es: "buenas noches", ja: "こんばんは", fr: "bonsoir" },
  { en: "how are you", es: "como estas", ja: "元気ですか", fr: "comment ca va" },
  { en: "i am good", es: "estoy bien", ja: "元気です", fr: "je vais bien" },
  { en: "thank you", es: "gracias", ja: "ありがとう", fr: "merci" },
  { en: "thanks", es: "gracias", ja: "ありがとう", fr: "merci" },
  { en: "yes", es: "si", ja: "はい", fr: "oui" },
  { en: "no", es: "no", ja: "いいえ", fr: "non" },
  { en: "please", es: "por favor", ja: "お願いします", fr: "s'il vous plait" },
  { en: "sorry", es: "lo siento", ja: "ごめんなさい", fr: "desole" },
  { en: "where are you", es: "donde estas", ja: "どこですか", fr: "ou es-tu" },
  { en: "come here", es: "ven aqui", ja: "ここに来て", fr: "viens ici" },
  { en: "follow me", es: "sigueme", ja: "ついてきて", fr: "suis-moi" },
  { en: "meet at the stage", es: "nos vemos en el escenario", ja: "ステージで会いましょう", fr: "rendez-vous a la scene" },
  { en: "meet at the solar farm", es: "nos vemos en la granja solar", ja: "ソーラーファームで会いましょう", fr: "rendez-vous a la ferme solaire" },
  { en: "nice avatar", es: "bonito avatar", ja: "いいアバターですね", fr: "bel avatar" },
  { en: "want to chat", es: "quieres chatear", ja: "話しませんか", fr: "tu veux discuter" },
  { en: "see you later", es: "hasta luego", ja: "またね", fr: "a plus tard" }
];

function translateWithPhrasebook(text, from, to) {
  const source = String(text || "").trim();
  if (!source || from === to) return source;

  const normalized = normalizeText(source);
  const exact = phrasebook.find((entry) => normalizeText(entry[from]) === normalized);
  if (exact) return exact[to];

  const translatedWords = normalized.split(" ").map((word) => {
    const match = phrasebook.find((entry) => normalizeText(entry[from]) === word);
    return match ? match[to] : word;
  });
  const translated = translatedWords.join(to === "ja" ? "" : " ");
  return translated === normalized ? `${source} (${SUPPORTED_LANGUAGES[to]})` : translated;
}

function extractOpenAIText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") return content.text.trim();
    }
  }
  return "";
}

async function translateWithOpenAI(text, from, to) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: [
        "You are a precise chat translator for a virtual lobby.",
        "Translate the user's message naturally and faithfully.",
        "Preserve names, emoji, URLs, punctuation style, and casual tone.",
        "Return only the translated text. Do not add explanations."
      ].join(" "),
      input: `Translate from ${SUPPORTED_LANGUAGES[from]} to ${SUPPORTED_LANGUAGES[to]}:\n${text}`
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI translation failed with ${response.status}`);
  }

  const payload = await response.json();
  return extractOpenAIText(payload);
}

async function translateWithLibreTranslate(text, from, to) {
  const baseUrl = process.env.LIBRETRANSLATE_URL.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: text,
      source: from,
      target: to,
      format: "text",
      api_key: process.env.LIBRETRANSLATE_API_KEY || undefined
    })
  });

  if (!response.ok) {
    throw new Error(`LibreTranslate failed with ${response.status}`);
  }

  const payload = await response.json();
  return String(payload.translatedText || "").trim();
}

async function translateMessage(text, from, to) {
  if (from === to) {
    return { translatedText: text, provider: "same-language" };
  }

  if (process.env.OPENAI_API_KEY) {
    return { translatedText: await translateWithOpenAI(text, from, to), provider: "openai" };
  }

  if (process.env.LIBRETRANSLATE_URL) {
    return { translatedText: await translateWithLibreTranslate(text, from, to), provider: "libretranslate" };
  }

  return { translatedText: translateWithPhrasebook(text, from, to), provider: "offline phrasebook" };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    json(res, 200, {
      ok: true,
      players: players.size,
      translationProvider: translationProviderName()
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    json(res, 200, {
      translationProvider: translationProviderName(),
      languages: SUPPORTED_LANGUAGES
    });
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
    broadcastState();
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

  if (req.method === "POST" && url.pathname === "/api/translate") {
    const data = await readBody(req);
    const text = safeText(data.text, 500);
    const from = safeOption(data.from, Object.keys(SUPPORTED_LANGUAGES), "en");
    const to = safeOption(data.to, Object.keys(SUPPORTED_LANGUAGES), "es");

    if (!text) {
      json(res, 400, { error: "Missing text" });
      return true;
    }

    const result = await translateMessage(text, from, to);
    json(res, 200, {
      translatedText: safeText(result.translatedText, 700),
      provider: result.provider
    });
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
  console.log(`Translation provider: ${translationProviderName()}`);
});
