import http from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { BrowserSession } from "./server/browser-session.mjs";
import { readJson, sendJson } from "./server/http-utils.mjs";

const isStartScript = process.env.npm_lifecycle_event === "start";
const dev = process.env.NODE_ENV ? process.env.NODE_ENV !== "production" : !isStartScript;
const hostname = process.env.HOST || "localhost";
const port = Number(process.env.PORT || 3000);
const HEARTBEAT_INTERVAL_MS = 15_000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const clients = new Set();
const sendToClient = (client, payload) => {
  if (client.readyState === client.OPEN) {
    client.send(JSON.stringify(payload));
  }
};

const broadcast = (payload) => {
  for (const client of clients) {
    sendToClient(client, payload);
  }
};

const browserSession = new BrowserSession({
  onFrame: (frame) => broadcast(frame),
  onStatus: (status) => broadcast({ type: "status", status })
});

async function handleApiRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      uptime: process.uptime(),
      browser: browserSession.getStatus()
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/browser/status") {
    sendJson(res, 200, browserSession.getStatus());
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/browser/start") {
    const body = await readJson(req).catch(() => ({}));
    const status = await browserSession.start({ url: body.url });
    sendJson(res, status.state === "error" ? 500 : 200, status);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/browser/stop") {
    const status = await browserSession.stop();
    sendJson(res, 200, status);
    return true;
  }

  return false;
}

await app.prepare();

const server = http.createServer(async (req, res) => {
  try {
    const handled = await handleApiRequest(req, res);

    if (!handled) {
      handle(req, res);
    }
  } catch (error) {
    sendJson(res, 500, {
      state: "error",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (socket) => {
  socket.isAlive = true;
  clients.add(socket);
  sendToClient(socket, {
    type: "status",
    status: browserSession.getStatus()
  });

  socket.on("pong", () => {
    socket.isAlive = true;
  });

  socket.on("message", async (raw) => {
    try {
      const message = JSON.parse(raw.toString());

      if (message.type === "navigate") {
        const status = await browserSession.navigate(message.url);
        sendToClient(socket, { type: "status", status });
        return;
      }

      if (message.type === "reload") {
        const status = await browserSession.reload();
        sendToClient(socket, { type: "status", status });
        return;
      }

      if (message.type === "history.back") {
        const status = await browserSession.goBack();
        sendToClient(socket, { type: "status", status });
        return;
      }

      if (message.type === "history.forward") {
        const status = await browserSession.goForward();
        sendToClient(socket, { type: "status", status });
        return;
      }

      await browserSession.handleInput(message);
    } catch (error) {
      sendToClient(socket, {
        type: "error",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  socket.on("close", () => {
    clients.delete(socket);
  });
});

const heartbeat = setInterval(() => {
  for (const socket of clients) {
    if (!socket.isAlive) {
      clients.delete(socket);
      socket.terminate();
      continue;
    }

    socket.isAlive = false;
    socket.ping();
  }
}, HEARTBEAT_INTERVAL_MS);

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname !== "/ws/browser") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

async function shutdown() {
  clearInterval(heartbeat);
  wss.close();
  await browserSession.stop({ quiet: true });
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(port, () => {
  console.log(`Remote browser app ready at http://${hostname}:${port}`);
});
