# BLD Remote Browser Control

Local remote browser control demo for the BLD SDE Intern assignment.

The project is built around a simple idea: the React UI is the operator panel, the Node server owns the browser session, Docker isolates Chromium, and Chrome DevTools Protocol moves frames and input events between them.

## Tech Stack

- React through Next.js
- Node.js
- Docker
- Headless Chromium
- Chrome DevTools Protocol
- WebSocket streaming

## How It Works

1. The React UI calls `POST /api/browser/start`.
2. The Node server checks whether the local Chromium Docker image exists.
3. If the image is missing, the server builds it from `Dockerfile.browser`.
4. Docker starts a Chromium container with DevTools Protocol exposed on port `9222`.
5. The server connects to Chromium through `puppeteer-core`.
6. Chromium sends screencast frames through CDP.
7. The server forwards those frames to the React UI over WebSocket.
8. Click, scroll, type, and navigation events travel back through the same WebSocket.

## Run Locally

Make sure Docker Desktop is running before starting the browser. On Windows, the app uses Docker Desktop's Linux engine pipe by default. If your Docker setup uses a different socket, set `DOCKER_SOCKET` before running the app.

Install dependencies:

```bash
npm install
```

Copy the environment example if you want to customize ports or viewport size:

```bash
cp .env.example .env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Optional: pre-build the browser image before recording:

```bash
npm run browser:build
```

Start the app:

```bash
npm run dev
```

Open:

```txt
http://localhost:3000
```

Optional viewport override:

```bash
BROWSER_WIDTH=1440 BROWSER_HEIGHT=900 npm run dev
```

Or set the same values in Windows PowerShell:

```powershell
$env:BROWSER_WIDTH="1440"; $env:BROWSER_HEIGHT="900"; npm run dev
```

## Demo Checklist

- Click **Start Browser**.
- Wait for the Chromium frame to appear.
- Navigate using the URL bar.
- Click inside the streamed page.
- Scroll inside the viewport.
- Type into a focused input on the remote page.
- Click **Stop** and confirm the session returns to idle.

## Screen Recording Flow

For the submission video, a simple flow is enough:

1. Show the app open at `localhost:3000`.
2. Click **Start Browser**.
3. Wait until the Chromium page appears.
4. Use the URL bar to open a page with an input, such as a search page.
5. Click inside the streamed page.
6. Type, paste, scroll, reload, and use back/forward once.
7. Click **Stop**.

Keep the recording focused on the working behavior. The form can explain the technical decisions separately.

## Troubleshooting

- If starting fails with a Docker socket or named pipe error, start Docker Desktop and try again.
- If the first start is slow, the Chromium Docker image is probably building.
- If typing does nothing, click once inside the browser viewport so it receives keyboard focus.
- If the stream stops after refreshing the UI, wait a moment for the WebSocket reconnect.

## Local Health Check

The server exposes a small health endpoint:

```txt
GET /api/health
```

It returns server uptime and the current browser session status. This is useful for checking whether the Node server is alive before debugging Docker or Chromium.


## Known Limits

- The app supports one browser session at a time.
- Streaming uses CDP screencast frames, so it is good for a local demo but not as smooth as production WebRTC.
- Keyboard handling covers common typing and navigation keys.
- Docker Desktop must be running locally before the browser container can start.
- There is no auth or deployment because the assignment only asks for a local system.
