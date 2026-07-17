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
  durationMs: number;
}

export interface AllowedCommandResult extends ProcessOutput {
  project: string;
  command: string[];
  cwd: string;
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
  const startedAt = Date.now();
  const output = await spawnProcess(command, args, absolutePath, timeoutSeconds, {
    useShell: process.platform === "win32" && (executable === "npm" || executable === "composer"),
  });

  return {
    project,
    command: [executable, ...args],
    cwd: relativePath,
    durationMs: Date.now() - startedAt,
    ...output,
  };
}

export async function runGit(
  cwd: string,
  args: string[],
  timeoutSeconds = 120,
): Promise<ProcessOutput> {
  const startedAt = Date.now();
  const output = await spawnProcess("git", args, cwd, timeoutSeconds, { useShell: false });
  return { ...output, durationMs: Date.now() - startedAt };
}

async function spawnProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutSeconds: number,
  options: { useShell: boolean },
): Promise<Omit<ProcessOutput, "durationMs">> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: options.useShell,
      windowsHide: true,
      env: { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutSeconds * 1000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        timedOut,
      });
    });
  });
}
