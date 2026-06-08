const viewport = document.querySelector("#viewport");
const world = document.querySelector("#world");
const playersLayer = document.querySelector("#players");
const bubblesLayer = document.querySelector("#bubbles");
const radius = document.querySelector("#radius");
const statusText = document.querySelector("#status");
const nearbyCount = document.querySelector("#nearbyCount");
const peopleList = document.querySelector("#peopleList");
const joinForm = document.querySelector("#joinForm");
const chatPanel = document.querySelector("#chatPanel");
const chatForm = document.querySelector("#chatForm");
const messages = document.querySelector("#messages");
const messageInput = document.querySelector("#messageInput");
const chatHint = document.querySelector("#chatHint");
const swatches = document.querySelector("#swatches");
const touchControls = document.querySelector("#touchControls");

const keys = new Set();
let selectedColor = "#3f7cff";
let selfId = null;
let self = null;
let eventSource = null;
let state = {
  world: { width: 1800, height: 1100 },
  hearingRadius: 210,
  players: [],
  nearbyIds: []
};
let camera = { x: 0, y: 0, scale: 1 };
let lastMoveSent = 0;
let lastLocalMove = performance.now();
let moveInFlight = false;
let pendingMove = null;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function api(path, data) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  }).then((response) => {
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json();
  });
}

function fitCamera() {
  if (!self) return;

  const viewportRect = viewport.getBoundingClientRect();
  const scale = Math.min(1, Math.max(0.58, Math.min(viewportRect.width / 920, viewportRect.height / 620)));
  camera.scale = scale;
  camera.x = viewportRect.width / 2 - self.x * scale;
  camera.y = viewportRect.height / 2 - self.y * scale;

  const minX = viewportRect.width - state.world.width * scale;
  const minY = viewportRect.height - state.world.height * scale;
  camera.x = Math.min(0, Math.max(minX, camera.x));
  camera.y = Math.min(0, Math.max(minY, camera.y));

  world.style.transform = `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${scale})`;
}

function renderPlayers() {
  const nearby = new Set(state.nearbyIds);

  playersLayer.innerHTML = state.players
    .map((player) => {
      const classes = ["avatar"];
      if (player.id === selfId) classes.push("self");
      if (nearby.has(player.id)) classes.push("nearby");

      return `
          <div class="${classes.join(" ")}" style="--x: ${player.x}px; --y: ${player.y}px; --avatar-color: ${player.color}">
            <div class="body shape-${escapeHtml(player.shape || "circle")}">
              <span class="icon">${escapeHtml(player.face)}</span>
              ${player.accessory ? `<span class="accessory">${escapeHtml(player.accessory)}</span>` : ""}
              <span class="badge">${escapeHtml(player.badge || "✦")}</span>
            </div>
            <div class="nameplate">${escapeHtml(player.name)}</div>
          </div>
        `;
    })
    .join("");

  peopleList.innerHTML = state.players.length
    ? state.players
        .map((player) => {
          const isSelf = player.id === selfId;
          const isNearby = nearby.has(player.id);
          const tag = isSelf ? "you" : isNearby ? "nearby" : "far";
          return `
            <div class="person">
              <span>${escapeHtml(player.face)} ${escapeHtml(player.badge || "✦")} ${escapeHtml(player.name)}</span>
              <span class="tag">${tag}</span>
            </div>
          `;
        })
        .join("")
    : `<div class="person"><span>No one here yet</span><span class="tag">empty</span></div>`;
}

function renderHud() {
  const count = state.nearbyIds.length;
  nearbyCount.textContent = `${count} nearby`;
  chatHint.textContent = count ? `${count} in range` : "Move close to talk";
  statusText.textContent = self ? "Walk with WASD or arrow keys. Chat only reaches nearby people." : "Choose a character to enter.";

  if (self) {
    radius.style.transform = `translate3d(${self.x}px, ${self.y}px, 0)`;
  }

  chatPanel.classList.toggle("is-disabled", !self);
  messageInput.disabled = !self;
  chatForm.querySelector("button").disabled = !self;
}

function render() {
  const serverSelf = state.players.find((player) => player.id === selfId);
  if (!self || !isMoving()) {
    self = serverSelf || self;
  }
  if (self && serverSelf && isMoving()) {
    Object.assign(serverSelf, self);
  }
  renderPlayers();
  renderHud();
  fitCamera();
}

function showChat(chat) {
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.style.left = `${chat.x}px`;
  bubble.style.top = `${chat.y}px`;
  bubble.innerHTML = `<strong>${escapeHtml(chat.fromName)}:</strong> ${escapeHtml(chat.text)}`;
  bubblesLayer.appendChild(bubble);
  window.setTimeout(() => bubble.remove(), 7000);

  const row = document.createElement("div");
  row.className = "message";
  row.innerHTML = `<strong>${escapeHtml(chat.fromName)}</strong><span>${escapeHtml(chat.text)}</span>`;
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
}

function connectEvents() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource(`/api/events?id=${encodeURIComponent(selfId)}`);
  eventSource.addEventListener("state", (event) => {
    state = JSON.parse(event.data);
    render();
  });
  eventSource.addEventListener("chat", (event) => {
    showChat(JSON.parse(event.data));
  });
  eventSource.onerror = () => {
    statusText.textContent = "Connection hiccup. Reconnecting...";
  };
}

function moveSelf(deltaSeconds) {
  if (!self) return;

  let dx = 0;
  let dy = 0;
  if (keys.has("ArrowLeft") || keys.has("a")) dx -= 1;
  if (keys.has("ArrowRight") || keys.has("d")) dx += 1;
  if (keys.has("ArrowUp") || keys.has("w")) dy -= 1;
  if (keys.has("ArrowDown") || keys.has("s")) dy += 1;

  if (!dx && !dy) return;

  const length = Math.hypot(dx, dy) || 1;
  const speed = 250;
  self.x = Math.max(24, Math.min(state.world.width - 24, self.x + (dx / length) * speed * deltaSeconds));
  self.y = Math.max(24, Math.min(state.world.height - 24, self.y + (dy / length) * speed * deltaSeconds));
  self.direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";

  const stateSelf = state.players.find((player) => player.id === selfId);
  if (stateSelf) Object.assign(stateSelf, self);
  render();

  const now = performance.now();
  if (now - lastMoveSent > 90) {
    lastMoveSent = now;
    sendMove(self);
  }
}

function isMoving() {
  return keys.has("ArrowLeft") || keys.has("ArrowRight") || keys.has("ArrowUp") || keys.has("ArrowDown") || keys.has("a") || keys.has("d") || keys.has("w") || keys.has("s");
}

function sendMove(player) {
  const move = {
    id: player.id,
    x: player.x,
    y: player.y,
    direction: player.direction
  };

  if (moveInFlight) {
    pendingMove = move;
    return;
  }

  moveInFlight = true;
  api("/api/move", move)
    .catch(() => {
      statusText.textContent = "Could not send movement.";
    })
    .finally(() => {
      moveInFlight = false;
      if (pendingMove) {
        const nextMove = pendingMove;
        pendingMove = null;
        sendMove(nextMove);
      }
    });
}

function nudgeSelf(key) {
  if (!self) return;
  const movementKeys = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d"]);
  if (!movementKeys.has(key)) return;
  moveSelf(0.055);
}

function loop(now) {
  const deltaSeconds = Math.min(0.05, (now - lastLocalMove) / 1000);
  lastLocalMove = now;
  moveSelf(deltaSeconds);
  requestAnimationFrame(loop);
}

swatches.addEventListener("click", (event) => {
  const button = event.target.closest(".swatch");
  if (!button) return;
  selectedColor = button.dataset.color;
  swatches.querySelectorAll(".swatch").forEach((swatch) => swatch.classList.remove("active"));
  button.classList.add("active");
});

touchControls.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("[data-key]");
  if (!button) return;
  keys.add(button.dataset.key);
  nudgeSelf(button.dataset.key);
  event.preventDefault();
});

touchControls.addEventListener("pointerup", (event) => {
  const button = event.target.closest("[data-key]");
  if (!button) return;
  keys.delete(button.dataset.key);
});

touchControls.addEventListener("pointerleave", () => {
  keys.delete("ArrowUp");
  keys.delete("ArrowDown");
  keys.delete("ArrowLeft");
  keys.delete("ArrowRight");
});

touchControls.addEventListener("pointercancel", () => {
  keys.delete("ArrowUp");
  keys.delete("ArrowDown");
  keys.delete("ArrowLeft");
  keys.delete("ArrowRight");
});

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.querySelector("#nameInput").value;
  const face = document.querySelector("#faceInput").value;
  const accessory = document.querySelector("#accessoryInput").value;
  const badge = document.querySelector("#badgeInput").value;
  const shape = document.querySelector("#shapeInput").value;
  const result = await api("/api/join", { name, face, accessory, badge, shape, color: selectedColor });

  selfId = result.player.id;
  self = result.player;
  state.world = result.world;
  state.hearingRadius = result.hearingRadius;
  state.players = [result.player];
  joinForm.style.display = "none";
  messageInput.disabled = false;
  chatForm.querySelector("button").disabled = false;
  connectEvents();
  render();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!self || !text) return;
  messageInput.value = "";
  await api("/api/chat", { id: selfId, text }).catch(() => {
    statusText.textContent = "Could not send chat.";
  });
});

window.addEventListener("keydown", (event) => {
  if (event.target.matches("input, select, textarea")) return;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d"].includes(event.key)) {
    keys.add(event.key);
    nudgeSelf(event.key);
    event.preventDefault();
  }
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key);
});

window.addEventListener("resize", fitCamera);

window.addEventListener("beforeunload", () => {
  if (selfId) {
    navigator.sendBeacon("/api/leave", JSON.stringify({ id: selfId }));
  }
});

requestAnimationFrame(loop);
render();
