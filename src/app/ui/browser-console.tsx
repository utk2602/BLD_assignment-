"use client";

import {
  AlertCircle,
  Globe2,
  Keyboard,
  Loader2,
  MonitorPlay,
  MousePointer2,
  Power,
  RefreshCcw,
  Square,
  TerminalSquare
} from "lucide-react";
import { FormEvent, KeyboardEvent, PointerEvent, WheelEvent, useEffect, useRef, useState } from "react";

type BrowserStatus = {
  state: "idle" | "starting" | "running" | "stopping" | "error";
  error: string | null;
  containerId: string | null;
  cdpPort: string | null;
  currentUrl: string;
  viewport: {
    width: number;
    height: number;
  };
};

type FrameMetadata = {
  deviceWidth?: number;
  deviceHeight?: number;
};

const DEFAULT_STATUS: BrowserStatus = {
  state: "idle",
  error: null,
  containerId: null,
  cdpPort: null,
  currentUrl: "https://example.com",
  viewport: {
    width: 1365,
    height: 768
  }
};

const stateLabel: Record<BrowserStatus["state"], string> = {
  idle: "Idle",
  starting: "Starting",
  running: "Running",
  stopping: "Stopping",
  error: "Error"
};

function socketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/browser`;
}

export function BrowserConsole() {
  const [status, setStatus] = useState<BrowserStatus>(DEFAULT_STATUS);
  const [frame, setFrame] = useState<string | null>(null);
  const [frameSize, setFrameSize] = useState(DEFAULT_STATUS.viewport);
  const [url, setUrl] = useState(DEFAULT_STATUS.currentUrl);
  const [socketState, setSocketState] = useState("Disconnected");
  const [notice, setNotice] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const busy = status.state === "starting" || status.state === "stopping";
  const running = status.state === "running";

  useEffect(() => {
    let closedByEffect = false;
    const ws = new WebSocket(socketUrl());
    socketRef.current = ws;
    setSocketState("Connecting");

    ws.addEventListener("open", () => {
      setSocketState("Connected");
    });

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);

      if (message.type === "status") {
        setStatus(message.status);
        setUrl(message.status.currentUrl || DEFAULT_STATUS.currentUrl);
        return;
      }

      if (message.type === "frame") {
        const metadata = message.metadata as FrameMetadata;
        setFrame(`data:image/jpeg;base64,${message.data}`);
        setFrameSize({
          width: metadata.deviceWidth || DEFAULT_STATUS.viewport.width,
          height: metadata.deviceHeight || DEFAULT_STATUS.viewport.height
        });
        return;
      }

      if (message.type === "error") {
        setNotice(message.error);
      }
    });

    ws.addEventListener("close", () => {
      if (!closedByEffect) {
        setSocketState("Disconnected");
      }
    });

    ws.addEventListener("error", () => {
      setSocketState("Disconnected");
    });

    fetch("/api/browser/status")
      .then((response) => response.json())
      .then((nextStatus) => setStatus(nextStatus))
      .catch(() => setNotice("Could not read browser status"));

    return () => {
      closedByEffect = true;
      ws.close();
    };
  }, []);

  async function startBrowser() {
    setNotice("Starting Chromium. First run may build the Docker image.");
    const response = await fetch("/api/browser/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url })
    });
    const nextStatus = await response.json();
    setStatus(nextStatus);
    setNotice(response.ok ? null : nextStatus.error || "Failed to start browser");
  }

  async function stopBrowser() {
    setNotice("Stopping browser container.");
    const response = await fetch("/api/browser/stop", { method: "POST" });
    const nextStatus = await response.json();
    setStatus(nextStatus);
    setFrame(null);
    setNotice(response.ok ? null : nextStatus.error || "Failed to stop browser");
  }

  function send(message: unknown) {
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setNotice("WebSocket is not connected yet");
      return;
    }

    socket.send(JSON.stringify(message));
  }

  function toBrowserPoint(event: PointerEvent<HTMLDivElement>) {
    const element = viewportRef.current;

    if (!element) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    const scale = Math.min(rect.width / frameSize.width, rect.height / frameSize.height);
    const renderedWidth = frameSize.width * scale;
    const renderedHeight = frameSize.height * scale;
    const offsetX = (rect.width - renderedWidth) / 2;
    const offsetY = (rect.height - renderedHeight) / 2;
    const x = (event.clientX - rect.left - offsetX) / scale;
    const y = (event.clientY - rect.top - offsetY) / scale;

    if (x < 0 || y < 0 || x > frameSize.width || y > frameSize.height) {
      return null;
    }

    return {
      x: Math.round(x),
      y: Math.round(y)
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!running || !frame) {
      return;
    }

    const point = toBrowserPoint(event);

    if (point) {
      send({ type: "mouse.move", ...point });
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!running || !frame) {
      return;
    }

    viewportRef.current?.focus();
    const point = toBrowserPoint(event);

    if (point) {
      send({ type: "mouse.click", ...point, button: "left" });
    }
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (!running || !frame) {
      return;
    }

    event.preventDefault();
    send({
      type: "scroll",
      deltaX: event.deltaX,
      deltaY: event.deltaY
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!running || event.repeat) {
      return;
    }

    event.preventDefault();
    send({
      type: "key",
      key: event.key
    });
  }

  function handleNavigate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send({
      type: "navigate",
      url
    });
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">BLD Assignment</p>
            <h1>Remote Browser Control</h1>
          </div>
          <div className={`status-pill status-${status.state}`}>
            {busy ? <Loader2 aria-hidden="true" className="spin" size={15} /> : <Power aria-hidden="true" size={15} />}
            {stateLabel[status.state]}
          </div>
        </header>

        <div className="toolbar">
          <div className="control-row">
            <button className="primary-action" disabled={busy || running} onClick={startBrowser} type="button">
              <MonitorPlay aria-hidden="true" size={18} />
              Start Browser
            </button>
            <button className="secondary-action" disabled={busy || status.state === "idle"} onClick={stopBrowser} type="button">
              <Square aria-hidden="true" size={16} />
              Stop
            </button>
          </div>

          <form className="url-bar" onSubmit={handleNavigate}>
            <Globe2 aria-hidden="true" size={17} />
            <input
              aria-label="Browser URL"
              disabled={!running}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com"
              value={url}
            />
            <button disabled={!running} title="Navigate" type="submit">
              <RefreshCcw aria-hidden="true" size={16} />
            </button>
          </form>
        </div>

        <div className="meta-strip">
          <span>
            <TerminalSquare aria-hidden="true" size={15} />
            WebSocket: {socketState}
          </span>
          <span>
            <MousePointer2 aria-hidden="true" size={15} />
            Click and scroll inside the viewport
          </span>
          <span>
            <Keyboard aria-hidden="true" size={15} />
            Click viewport before typing
          </span>
        </div>

        {(notice || status.error) && (
          <div className="notice">
            <AlertCircle aria-hidden="true" size={16} />
            {notice || status.error}
          </div>
        )}

        <div
          aria-label="Remote browser viewport"
          className={`browser-frame ${running ? "is-running" : ""}`}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onWheel={handleWheel}
          ref={viewportRef}
          tabIndex={0}
        >
          {frame ? (
            <img alt="Live Chromium screencast" className="browser-image" draggable={false} src={frame} />
          ) : (
            <div className="empty-state">
              {busy ? <Loader2 aria-hidden="true" className="spin" size={36} /> : <MonitorPlay aria-hidden="true" size={36} />}
              <p>{busy ? "Preparing the browser container..." : "Start the browser to stream Chromium here."}</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

