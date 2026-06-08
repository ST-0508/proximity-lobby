const BASE = "http://localhost:3000";

async function post(path, payload) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function openEvents(id) {
  const controller = new AbortController();
  const events = [];
  const ready = fetch(`${BASE}/api/events?id=${encodeURIComponent(id)}`, {
    signal: controller.signal
  }).then(async (response) => {
    if (!response.ok) throw new Error(`events failed with ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let splitAt;
      while ((splitAt = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, splitAt);
        buffer = buffer.slice(splitAt + 2);
        const type = raw.match(/^event: (.+)$/m)?.[1];
        const data = raw.match(/^data: (.+)$/m)?.[1];
        if (type && data) events.push({ type, data: JSON.parse(data) });
      }
    }
  });

  return { events, controller, ready };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const a = (await post("/api/join", { name: "Near A", color: "#3f7cff", face: "🙂" })).player;
  const b = (await post("/api/join", { name: "Near B", color: "#14a86b", face: "😎" })).player;
  const c = (await post("/api/join", { name: "Far C", color: "#eb4d7a", face: "🤖" })).player;
  const streams = [openEvents(a.id), openEvents(b.id), openEvents(c.id)];

  await post("/api/move", { ...a, x: 400, y: 400, direction: "down" });
  await post("/api/move", { ...b, x: 520, y: 410, direction: "down" });
  await post("/api/move", { ...c, x: 1100, y: 860, direction: "down" });
  await wait(300);

  await post("/api/chat", { id: a.id, text: "near-range check" });
  await wait(300);

  const received = streams.map((stream) =>
    stream.events.filter((event) => event.type === "chat").map((event) => event.data.text)
  );

  for (const stream of streams) {
    stream.controller.abort();
    stream.ready.catch(() => {});
  }

  await post("/api/leave", { id: a.id });
  await post("/api/leave", { id: b.id });
  await post("/api/leave", { id: c.id });

  const [aChats, bChats, cChats] = received;
  if (!aChats.includes("near-range check")) throw new Error("Sender did not receive own nearby chat");
  if (!bChats.includes("near-range check")) throw new Error("Nearby player did not receive chat");
  if (cChats.includes("near-range check")) throw new Error("Far player received chat outside hearing radius");

  console.log("PASS proximity chat: sender and nearby player received the message; far player did not.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
