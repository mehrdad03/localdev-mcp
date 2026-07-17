import { spawn } from "node:child_process";

export interface RipgrepMatch {
  path: string;
  line: number;
  text: string;
}

export interface RipgrepResult {
  available: boolean;
  results: RipgrepMatch[];
  truncated: boolean;
  timedOut: boolean;
  durationMs: number;
  error?: string;
}

export async function searchWithRipgrep(options: {
  root: string;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  glob: string;
  ignoreGlobs: string[];
  maxResults: number;
  timeoutSeconds?: number;
}): Promise<RipgrepResult> {
  const {
    root,
    query,
    regex,
    caseSensitive,
    glob,
    ignoreGlobs,
    maxResults,
    timeoutSeconds = 30,
  } = options;

  const args = [
    "--line-number",
    "--with-filename",
    "--no-heading",
    "--color",
    "never",
    "--no-messages",
    "--max-filesize",
    "1500K",
  ];
  if (!regex) args.push("--fixed-strings");
  if (!caseSensitive) args.push("--ignore-case");
  if (glob && glob !== "**/*") args.push("--glob", glob);
  for (const ignored of ignoreGlobs) args.push("--glob", `!${ignored}`);
  args.push("--", query, ".");

  const startedAt = Date.now();
  return await new Promise((resolve) => {
    const child = spawn("rg", args, {
      cwd: root,
      shell: false,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });

    const results: RipgrepMatch[] = [];
    let stdoutBuffer = "";
    let stderr = "";
    let timedOut = false;
    let truncated = false;
    let settled = false;

    const finish = (result: RipgrepResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutSeconds * 1000);

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const parsed = parseRipgrepLine(line);
        if (parsed) results.push(parsed);
        if (results.length >= maxResults) {
          truncated = true;
          child.kill();
          break;
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      finish({
        available: code !== "ENOENT" ? true : false,
        results: [],
        truncated: false,
        timedOut: false,
        durationMs: Date.now() - startedAt,
        error: error.message,
      });
    });
    child.on("close", (exitCode) => {
      if (stdoutBuffer && results.length < maxResults) {
        const parsed = parseRipgrepLine(stdoutBuffer);
        if (parsed) results.push(parsed);
      }
      finish({
        available: true,
        results: results.slice(0, maxResults),
        truncated,
        timedOut,
        durationMs: Date.now() - startedAt,
        error: exitCode !== 0 && exitCode !== 1 && !truncated ? stderr.trim().slice(0, 1000) : undefined,
      });
    });
  });
}

function parseRipgrepLine(line: string): RipgrepMatch | null {
  const first = line.indexOf(":");
  if (first <= 0) return null;
  const second = line.indexOf(":", first + 1);
  if (second <= first + 1) return null;
  const lineNumber = Number(line.slice(first + 1, second));
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return null;
  return {
    path: line.slice(0, first).replaceAll("\\", "/"),
    line: lineNumber,
    text: line.slice(second + 1).trim().slice(0, 500),
  };
}
