# Proximity Lobby

A browser-based virtual lobby with custom avatars, movement, proximity chat, experimental proximity voice chat, and a solar panel farm area.

## Run Locally

```bash
node server.js
```

Open `http://localhost:3000`.

## Make It Public

The app is ready for a Node host that supports long-lived HTTP connections for Server-Sent Events. Good fits include Render, Railway, Fly.io, Heroku-style hosts, or a VPS.

Set these environment variables on the host:

```bash
HOST=0.0.0.0
PORT=3000
```

Most hosting platforms set `PORT` automatically. In that case, only set `HOST=0.0.0.0`.

For a temporary public test from your own computer, use a tunnel such as Cloudflare Tunnel or ngrok pointed at `http://localhost:3000`. For a real public website, deploy the repo to a host and attach a domain.

## Voice Chat

Voice chat uses browser WebRTC and a public STUN server. It can work well for demos, especially on ordinary Wi-Fi, but some networks require a TURN relay for reliable connections.

Users must click **Start voice** and allow microphone access. Voice connections are only attempted with nearby players.

## Health Check

Use this endpoint for deployment monitoring:

```bash
GET /api/health
```
