import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { assertNoSymlinkEscape, resolveProjectPath } from "../security/path-guard.js";
import {
  loadApprovedSecretValues,
  redactKnownValues,
  resolvePhpExecutable,
} from "./laravel-integration.js";
import { redactSecrets, truncate } from "./text.js";

type ManagedProcess = {
  sessionId: string;
  project: string;
  cwd: string;
  kind: "laravel_server";
  host: string;
  port: number;
  startedAt: string;
  child: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  stoppedAt: string | null;
  secretValues: string[];
};

const managedProcesses = new Map<string, ManagedProcess>();
const MAX_BUFFER_CHARS = 120_000;

export async function startLaravelServer(options: {
  project: string;
  cwd: string;
  host: "127.0.0.1" | "localhost" | "::1";
  port: number;
  readinessTimeoutSeconds: number;
}): Promise<Record<string, unknown>> {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535 || (options.port > 0 && options.port < 1024)) {
    throw new Error("Local process port must be 0 for automatic selection or between 1024 and 65535.");
  }
  const selectedPort = options.port === 0
    ? await findAvailableLoopbackPort(options.host)
    : options.port;
  if (await isPortOpen(options.host, selectedPort, 300)) {
    throw new Error(`Port ${options.host}:${selectedPort} is already in use. LocalDev MCP will not stop or replace an unknown process.`);
  }

  const resolved = await resolveProjectPath(options.project, options.cwd);
  await assertNoSymlinkEscape(resolved.root, resolved.absolutePath);
  const php = await resolvePhpExecutable(options.project);
  const secretValues = await loadApprovedSecretValues(options.project, resolved.relativePath);
  const child = spawn(php, [
    "artisan",
    "serve",
    `--host=${options.host}`,
    `--port=${selectedPort}`,
    "--no-reload",
  ], {
    cwd: resolved.absolutePath,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end();

  const sessionId = `local-${randomUUID()}`;
  const record: ManagedProcess = {
    sessionId,
    project: options.project,
    cwd: resolved.relativePath,
    kind: "laravel_server",
    host: options.host,
    port: selectedPort,
    startedAt: new Date().toISOString(),
    child,
    stdout: "",
    stderr: "",
    exitCode: null,
    stoppedAt: null,
    secretValues,
  };
  managedProcesses.set(sessionId, record);

  child.stdout.on("data", (chunk) => {
    record.stdout = trimBuffer(record.stdout + chunk.toString());
  });
  child.stderr.on("data", (chunk) => {
    record.stderr = trimBuffer(record.stderr + chunk.toString());
  });
  child.on("close", (exitCode) => {
    record.exitCode = exitCode;
    record.stoppedAt = new Date().toISOString();
  });

  const ready = await waitForPort(
    options.host,
    selectedPort,
    options.readinessTimeoutSeconds * 1000,
    () => record.exitCode !== null,
  );
  if (!ready) {
    await killProcessTree(child.pid);
    throw new Error(
      `Laravel server did not become ready on ${options.host}:${selectedPort}. ${redactKnownValues(redactSecrets(record.stderr || record.stdout), record.secretValues)}`,
    );
  }

  return serializeProcess(record);
}

export function inspectLocalProcess(options: {
  project: string;
  sessionId: string;
}): Record<string, unknown> {
  const record = requireOwnedProcess(options.project, options.sessionId);
  return serializeProcess(record);
}

export async function stopLocalProcess(options: {
  project: string;
  sessionId: string;
  timeoutSeconds: number;
}): Promise<Record<string, unknown>> {
  const record = requireOwnedProcess(options.project, options.sessionId);
  if (record.exitCode === null) {
    await killProcessTree(record.child.pid);
    const deadline = Date.now() + options.timeoutSeconds * 1000;
    while (record.exitCode === null && Date.now() < deadline) {
      await delay(50);
    }
  }
  if (record.exitCode === null) {
    throw new Error("Managed process did not stop within the requested timeout.");
  }
  return serializeProcess(record);
}

export function listManagedProcessCount(): number {
  return managedProcesses.size;
}

function requireOwnedProcess(project: string, sessionId: string): ManagedProcess {
  if (!/^local-[0-9a-f-]{36}$/.test(sessionId)) throw new Error("Local process session ID is invalid.");
  const record = managedProcesses.get(sessionId);
  if (!record || record.project !== project) {
    throw new Error("Managed process was not found for this project. LocalDev MCP never adopts unrelated operating-system processes.");
  }
  return record;
}

function serializeProcess(record: ManagedProcess): Record<string, unknown> {
  return {
    sessionId: record.sessionId,
    project: record.project,
    cwd: record.cwd,
    kind: record.kind,
    host: record.host,
    port: record.port,
    pid: record.child.pid ?? null,
    running: record.exitCode === null,
    exitCode: record.exitCode,
    startedAt: record.startedAt,
    stoppedAt: record.stoppedAt,
    stdout: truncate(redactKnownValues(redactSecrets(record.stdout), record.secretValues), 60_000),
    stderr: truncate(redactKnownValues(redactSecrets(record.stderr), record.secretValues), 60_000),
  };
}

async function killProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) return;

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", () => resolve());
      killer.once("close", () => resolve());
    });
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already exited.
    }
  }
}

async function waitForPort(
  host: string,
  port: number,
  timeoutMs: number,
  exited: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited()) return false;
    if (await isPortOpen(host, port, 300)) return true;
    await delay(150);
  }
  return false;
}

async function findAvailableLoopbackPort(host: string): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not determine an automatically selected loopback port."));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function isPortOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function trimBuffer(value: string): string {
  return value.length <= MAX_BUFFER_CHARS ? value : value.slice(-MAX_BUFFER_CHARS);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
