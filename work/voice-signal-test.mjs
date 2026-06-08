const BASE = "http://localhost:3000";

async function post(path, payload) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} failed with ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function main() {
  const a = (await post("/api/join", { name: "Voice A", color: "#3f7cff", face: "🙂" })).player;
  const b = (await post("/api/join", { name: "Voice B", color: "#14a86b", face: "😎" })).player;

  await post("/api/move", { ...a, x: 400, y: 400, direction: "down" });
  await post("/api/move", { ...b, x: 490, y: 400, direction: "down" });
  await post("/api/signal", { fromId: a.id, toId: b.id, type: "voice-ready" });
  await post("/api/leave", { id: a.id });
  await post("/api/leave", { id: b.id });

  console.log("PASS voice signaling: nearby players can exchange voice-ready signals.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
