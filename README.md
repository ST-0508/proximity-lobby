# Proximity Lobby

A browser-based virtual lobby with custom avatars, movement, proximity chat, a solar panel farm area, and built-in translation.

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

## High-Quality Translation

The browser calls the server at `/api/translate`, so API keys stay private.

For best translation quality, set:

```bash
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-5-mini
```

Without `OPENAI_API_KEY`, the app falls back to a small offline phrasebook. That fallback is useful for demos but will not translate arbitrary sentences well.

You can also use a LibreTranslate-compatible service:

```bash
LIBRETRANSLATE_URL=https://your-libretranslate-server.example
LIBRETRANSLATE_API_KEY=optional_key
```

OpenAI is used first when both providers are configured.

## Health Check

Use this endpoint for deployment monitoring:

```bash
GET /api/health
```
