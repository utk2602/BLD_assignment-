import { spawnSync } from "node:child_process";

function run(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32"
  });
}

function firstLine(value) {
  return value.trim().split(/\r?\n/)[0] || "";
}

function pass(message) {
  console.log(`[ok] ${message}`);
}

function fail(message) {
  console.error(`[fail] ${message}`);
}

let failed = false;

const nodeMajor = Number(process.versions.node.split(".")[0]);

if (nodeMajor >= 20) {
  pass(`Node.js ${process.version}`);
} else {
  failed = true;
  fail(`Node.js 20+ is recommended. Current version: ${process.version}`);
}

const dockerVersion = run("docker", ["--version"]);

if (dockerVersion.status === 0) {
  pass(firstLine(dockerVersion.stdout));
} else {
  failed = true;
  fail("Docker CLI is not available on PATH");
}

const dockerInfo = run("docker", ["info"]);

if (dockerInfo.status === 0) {
  pass("Docker daemon is reachable");
} else {
  failed = true;
  fail("Docker daemon is not reachable. Start Docker Desktop and try again.");
}

if (failed) {
  process.exitCode = 1;
} else {
  pass("Preflight checks passed");
}

