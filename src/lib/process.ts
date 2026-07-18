import { spawn } from "node:child_process";
import { assertNoSymlinkEscape, resolveProjectPath } from "../security/path-guard.js";
import {
  type AllowedExecutable,
  validateCommand,
  windowsExecutableName,
} from "../security/command-policy.js";
import { truncate } from "./text.js";

export interface ProcessOutput {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputLimitExceeded?: boolean;
  durationMs: number;
}

export interface AllowedCommandResult extends ProcessOutput {
  project: string;
  command: string[];
  cwd: string;
}

export interface DirectProcessOptions {
  command: string;
  args?: string[];
  cwd: string;
  timeoutSeconds?: number;
  useShell?: boolean;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  maxOutputChars?: number;
}

export async function runAllowedCommand(options: {
  project: string;
  executable: AllowedExecutable;
  args?: string[];
  cwd?: string;
  timeoutSeconds?: number;
}): Promise<AllowedCommandResult> {
  const {
    project,
    executable,
    args = [],
    cwd = ".",
    timeoutSeconds = 120,
  } = options;

  validateCommand(executable, args);
  const { root, absolutePath, relativePath } = await resolveProjectPath(project, cwd);
  await assertNoSymlinkEscape(root, absolutePath);

  if (executable === "git" && (args[0] === "switch" || args[0] === "checkout")) {
    const status = await runGit(absolutePath, ["status", "--porcelain=v1"], Math.min(timeoutSeconds, 120));
    if (status.exitCode !== 0 || status.timedOut) {
      throw new Error("Git working-tree preflight failed before branch change.");
    }
    if (status.stdout.trim()) {
      throw new Error("Git branch changes through run_command require a clean working tree. Use git_switch_branch for explicit guarded control.");
    }
  }

  const command = windowsExecutableName(executable);
  const output = await runDirectProcess({
    command,
    args,
    cwd: absolutePath,
    timeoutSeconds,
    useShell: process.platform === "win32" && (executable === "npm" || executable === "composer"),
  });

  return {
    project,
    command: [executable, ...args],
    cwd: relativePath,
    ...output,
  };
}

export async function runGit(
  cwd: string,
  args: string[],
  timeoutSeconds = 120,
): Promise<ProcessOutput> {
  return runDirectProcess({
    command: "git",
    args,
    cwd,
    timeoutSeconds,
    useShell: false,
  });
}

export async function runDirectProcess(options: DirectProcessOptions): Promise<ProcessOutput> {
  const {
    command,
    args = [],
    cwd,
    timeoutSeconds = 120,
    useShell = false,
    env = {},
    stdin,
    maxOutputChars = 60_000,
  } = options;
  const startedAt = Date.now();

  const output = await new Promise<Omit<ProcessOutput, "durationMs">>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: useShell,
      windowsHide: true,
      env: {
        ...process.env,
        CI: "1",
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputLimitExceeded = false;
    let settled = false;

    const stopForLimit = () => {
      if (stdout.length + stderr.length <= maxOutputChars || outputLimitExceeded) return;
      outputLimitExceeded = true;
      child.kill();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutSeconds * 1000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      stopForLimit();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      stopForLimit();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: truncate(stdout, maxOutputChars),
        stderr: truncate(stderr, maxOutputChars),
        timedOut,
        outputLimitExceeded,
      });
    });

    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });

  return {
    ...output,
    durationMs: Date.now() - startedAt,
  };
}
