import { spawn } from "node:child_process";
import Docker from "dockerode";
import puppeteer from "puppeteer-core";

const IMAGE_TAG = "bld-remote-chromium:local";
const CONTAINER_PORT = "9222/tcp";
const DEFAULT_URL = "https://example.com";
const VIEWPORT = { width: 1365, height: 768 };

function dockerSocketPath() {
  if (process.env.DOCKER_SOCKET) {
    return process.env.DOCKER_SOCKET;
  }

  if (process.platform === "win32") {
    return "//./pipe/dockerDesktopLinuxEngine";
  }

  return "/var/run/docker.sock";
}

const docker = new Docker({
  socketPath: dockerSocketPath()
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeUrl(value) {
  if (!value || typeof value !== "string") {
    return DEFAULT_URL;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return DEFAULT_URL;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function runDockerBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      ["build", "-f", "Dockerfile.browser", "-t", IMAGE_TAG, "."],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(output.trim() || `docker build exited with code ${code}`));
    });
  });
}

async function ensureBrowserImage() {
  try {
    await docker.getImage(IMAGE_TAG).inspect();
  } catch {
    await runDockerBuild();
  }
}

async function waitForCdp(port) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  const started = Date.now();

  while (Date.now() - started < 30_000) {
    try {
      const response = await fetch(endpoint);

      if (response.ok) {
        return;
      }
    } catch {
      // Chromium is still booting.
    }

    await sleep(500);
  }

  throw new Error("Chromium did not expose the DevTools endpoint in time");
}

export class BrowserSession {
  constructor({ onFrame, onStatus }) {
    this.onFrame = onFrame;
    this.onStatus = onStatus;
    this.state = "idle";
    this.error = null;
    this.container = null;
    this.containerId = null;
    this.hostPort = null;
    this.browser = null;
    this.page = null;
    this.cdp = null;
    this.currentUrl = DEFAULT_URL;
  }

  getStatus() {
    return {
      state: this.state,
      error: this.error,
      containerId: this.containerId,
      cdpPort: this.hostPort,
      currentUrl: this.currentUrl,
      viewport: VIEWPORT
    };
  }

  setState(state, error = null) {
    this.state = state;
    this.error = error;
    this.onStatus?.(this.getStatus());
  }

  async start({ url } = {}) {
    if (this.state === "running" || this.state === "starting") {
      return this.getStatus();
    }

    this.setState("starting");
    this.currentUrl = normalizeUrl(url);

    try {
      await ensureBrowserImage();

      this.container = await docker.createContainer({
        Image: IMAGE_TAG,
        name: `bld-remote-browser-${Date.now()}`,
        ExposedPorts: {
          [CONTAINER_PORT]: {}
        },
        HostConfig: {
          AutoRemove: false,
          PortBindings: {
            [CONTAINER_PORT]: [{ HostPort: "0" }]
          }
        }
      });

      await this.container.start();
      this.containerId = this.container.id;

      const details = await this.container.inspect();
      const binding = details.NetworkSettings.Ports[CONTAINER_PORT]?.[0];
      this.hostPort = binding?.HostPort;

      if (!this.hostPort) {
        throw new Error("Docker did not publish Chromium's CDP port");
      }

      await waitForCdp(this.hostPort);

      this.browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${this.hostPort}`,
        defaultViewport: VIEWPORT
      });

      this.page = await this.browser.newPage();
      await this.page.setViewport(VIEWPORT);
      await this.page.goto(this.currentUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await this.startScreencast();
      this.setState("running");
      return this.getStatus();
    } catch (error) {
      await this.stop({ quiet: true });
      this.setState("error", error instanceof Error ? error.message : String(error));
      return this.getStatus();
    }
  }

  async startScreencast() {
    if (!this.page) {
      throw new Error("Cannot start screencast without an active page");
    }

    this.cdp = await this.page.target().createCDPSession();
    await this.cdp.send("Page.enable");
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 72,
      maxWidth: VIEWPORT.width,
      maxHeight: VIEWPORT.height,
      everyNthFrame: 1
    });

    this.cdp.on("Page.screencastFrame", (event) => {
      this.onFrame?.({
        type: "frame",
        data: event.data,
        metadata: event.metadata
      });

      this.cdp
        ?.send("Page.screencastFrameAck", { sessionId: event.sessionId })
        .catch(() => {});
    });
  }

  async navigate(url) {
    if (!this.page || this.state !== "running") {
      return this.getStatus();
    }

    this.currentUrl = normalizeUrl(url);
    await this.page.goto(this.currentUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });

    this.onStatus?.(this.getStatus());
    return this.getStatus();
  }

  async handleInput(message) {
    if (!this.page || this.state !== "running") {
      return;
    }

    if (message.type === "mouse.click") {
      await this.page.mouse.click(message.x, message.y, {
        button: message.button || "left"
      });
      return;
    }

    if (message.type === "mouse.move") {
      await this.page.mouse.move(message.x, message.y);
      return;
    }

    if (message.type === "scroll") {
      await this.page.mouse.wheel({
        deltaX: message.deltaX || 0,
        deltaY: message.deltaY || 0
      });
      return;
    }

    if (message.type === "key") {
      await this.handleKey(message);
    }
  }

  async handleKey(message) {
    const key = message.key;

    if (!key) {
      return;
    }

    if (key.length === 1) {
      await this.page.keyboard.type(key);
      return;
    }

    const supportedKeys = new Set([
      "Backspace",
      "Delete",
      "Enter",
      "Escape",
      "Tab",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
      "PageUp",
      "PageDown"
    ]);

    if (supportedKeys.has(key)) {
      await this.page.keyboard.press(key);
    }
  }

  async stop({ quiet = false } = {}) {
    if (this.state === "idle" && !this.container && !this.browser) {
      return this.getStatus();
    }

    if (!quiet) {
      this.setState("stopping");
    }

    try {
      if (this.cdp) {
        await this.cdp.detach().catch(() => {});
      }

      if (this.browser) {
        await this.browser.disconnect();
      }

      if (this.container) {
        await this.container.stop({ t: 1 }).catch(() => {});
        await this.container.remove({ force: true }).catch(() => {});
      }
    } finally {
      this.cdp = null;
      this.browser = null;
      this.page = null;
      this.container = null;
      this.containerId = null;
      this.hostPort = null;

      if (!quiet) {
        this.setState("idle");
      }
    }

    return this.getStatus();
  }
}

export { DEFAULT_URL, VIEWPORT, normalizeUrl };
