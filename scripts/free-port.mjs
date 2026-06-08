import { spawnSync } from "node:child_process";

const port = Number(process.argv[2] || process.env.PORT || 3000);

if (!Number.isInteger(port) || port <= 0) {
  console.error("Pass a valid port, for example: npm run free-port -- 3000");
  process.exit(1);
}

function run(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    shell: false
  });
}

if (process.platform === "win32") {
  const command = [
    "$connections = Get-NetTCPConnection",
    `-LocalPort ${port}`,
    "-State Listen",
    "-ErrorAction SilentlyContinue;",
    "$ids = $connections | Select-Object -ExpandProperty OwningProcess -Unique;",
    "if (-not $ids) { Write-Output 'No process is listening on the port.'; exit 0 }",
    "foreach ($id in $ids) {",
    "  $process = Get-Process -Id $id -ErrorAction SilentlyContinue;",
    "  if ($process) {",
    "    Write-Output \"Stopping $($process.ProcessName) PID $id\";",
    "    Stop-Process -Id $id -Force",
    "  }",
    "}"
  ].join(" ");

  const result = run("powershell.exe", ["-NoProfile", "-Command", command]);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 0);
}

const lookup = run("sh", ["-c", `lsof -ti tcp:${port}`]);
const pids = lookup.stdout
  .split(/\s+/)
  .map((value) => value.trim())
  .filter(Boolean);

if (pids.length === 0) {
  console.log("No process is listening on the port.");
  process.exit(0);
}

for (const pid of pids) {
  console.log(`Stopping PID ${pid}`);
  run("kill", ["-9", pid]);
}

