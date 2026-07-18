import { createHash, createHmac, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getProject } from "../config.js";
import { windowsExecutableName } from "../security/command-policy.js";
import { inspectTinkerCode } from "../security/laravel-policy.js";
import { assertNoSymlinkEscape, resolveProjectPath } from "../security/path-guard.js";
import { runDirectProcess, type ProcessOutput } from "./process.js";
import { redactSecrets, sha256, truncate } from "./text.js";

export type TinkerTransactionMode = "none" | "rollback" | "commit";
export type TinkerOutputMode = "full" | "sanitized" | "json";

const TINKER_DISABLED_FUNCTIONS = [
  "exec",
  "shell_exec",
  "system",
  "passthru",
  "proc_open",
  "popen",
  "curl_exec",
  "curl_multi_exec",
  "fsockopen",
  "pfsockopen",
  "stream_socket_client",
  "unlink",
  "rmdir",
  "chmod",
  "chown",
  "chgrp",
  "file_put_contents",
  "rename",
  "copy",
].join(",");

export interface LaravelExecutionResult extends ProcessOutput {
  project: string;
  cwd: string;
  command: string[];
  risk?: string;
}

export interface TinkerExecutionResult extends LaravelExecutionResult {
  transactionMode: TinkerTransactionMode;
  databaseWriteDetected: boolean;
  codeSha256: string;
  parsedResult?: unknown;
}

export type DatabaseWhere = Record<string, string | number | boolean | null>;

export interface DatabaseSnapshotInput {
  table: string;
  columns?: string[];
  where?: DatabaseWhere;
  limit?: number;
  orderBy?: { column: string; direction?: "asc" | "desc" };
}

export interface DatabaseSnapshotResult {
  table: string;
  count: number;
  rows: Array<Record<string, unknown>>;
}

export async function resolvePhpExecutable(projectName: string): Promise<string> {
  const project = await getProject(projectName);
  return project.phpExecutable?.trim() || windowsExecutableName("php");
}

export async function runLaravelProcess(options: {
  project: string;
  cwd: string;
  args: string[];
  timeoutSeconds: number;
  maxOutputChars?: number;
}): Promise<LaravelExecutionResult> {
  const resolved = await resolveProjectPath(options.project, options.cwd);
  await assertNoSymlinkEscape(resolved.root, resolved.absolutePath);
  const projectConfig = await getProject(options.project);
  const php = await resolvePhpExecutable(options.project);
  const secretValues = await readSelectedDotEnvValues(
    path.join(resolved.absolutePath, ".env"),
    projectConfig.allowedSecretEnvKeys,
  );
  const result = await runDirectProcess({
    command: php,
    args: options.args,
    cwd: resolved.absolutePath,
    timeoutSeconds: options.timeoutSeconds,
    useShell: false,
    maxOutputChars: options.maxOutputChars ?? 120_000,
  });

  return {
    project: options.project,
    cwd: resolved.relativePath,
    command: ["php", ...options.args],
    ...sanitizeProcessOutput(result, secretValues),
  };
}

export async function executeLaravelTinker(options: {
  project: string;
  cwd: string;
  code: string;
  timeoutSeconds: number;
  transactionMode: TinkerTransactionMode;
  outputMode: TinkerOutputMode;
  allowDatabaseWrite: boolean;
  maxOutputChars?: number;
}): Promise<TinkerExecutionResult> {
  const inspection = inspectTinkerCode(options.code);
  if (inspection.databaseWriteDetected && !options.allowDatabaseWrite) {
    throw new Error("Tinker code appears to write to the database. Set allowDatabaseWrite=true after reviewing the code.");
  }
  if (options.transactionMode === "commit" && !options.allowDatabaseWrite) {
    throw new Error("transactionMode=commit requires allowDatabaseWrite=true.");
  }

  const resolved = await resolveProjectPath(options.project, options.cwd);
  await assertNoSymlinkEscape(resolved.root, resolved.absolutePath);
  const projectConfig = await getProject(options.project);
  const php = await resolvePhpExecutable(options.project);
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "localdev-mcp-tinker-"));
  const snippetPath = path.join(temporaryRoot, `${randomUUID()}.php`);
  const resultMarker = `__LOCALDEV_MCP_RESULT_${randomUUID().replaceAll("-", "")}__`;
  const endMarker = `__LOCALDEV_MCP_END_${randomUUID().replaceAll("-", "")}__`;
  const wrapper = buildTinkerSnippet(options.code, options.transactionMode, resultMarker, endMarker);
  const secretValues = await readSelectedDotEnvValues(
    path.join(resolved.absolutePath, ".env"),
    projectConfig.allowedSecretEnvKeys,
  );

  try {
    await writeFile(snippetPath, wrapper, { encoding: "utf8", flag: "wx" });
    const normalizedSnippetPath = snippetPath.replaceAll("\\", "/").replaceAll("'", "\\'");
    const executeArgument = `--execute=include '${normalizedSnippetPath}';`;
    const processResult = await runDirectProcess({
      command: php,
      args: [
        "-d",
        `disable_functions=${TINKER_DISABLED_FUNCTIONS}`,
        "-d",
        "allow_url_fopen=0",
        "artisan",
        "tinker",
        executeArgument,
      ],
      cwd: resolved.absolutePath,
      timeoutSeconds: options.timeoutSeconds,
      useShell: false,
      env: {
        PSYSH_HISTORY_FILE: path.join(temporaryRoot, "history"),
        XDG_CACHE_HOME: temporaryRoot,
      },
      maxOutputChars: options.maxOutputChars ?? 120_000,
    });
    const sanitized = sanitizeProcessOutput(processResult, secretValues);
    if (sanitized.timedOut) throw new Error("Laravel Tinker execution timed out.");
    if (sanitized.outputLimitExceeded) throw new Error("Laravel Tinker execution exceeded the configured output limit.");
    if (sanitized.exitCode !== 0) {
      const detail = truncate((sanitized.stderr || sanitized.stdout).trim(), 4000);
      throw new Error(`Laravel Tinker execution failed with exit code ${sanitized.exitCode ?? "unknown"}${detail ? `: ${detail}` : "."}`);
    }
    const parsedResult = extractMarkedJson(sanitized.stdout, resultMarker, endMarker);
    if (options.outputMode === "json" && parsedResult === undefined) {
      throw new Error("Laravel Tinker execution completed without a valid structured result marker.");
    }

    return {
      project: options.project,
      cwd: resolved.relativePath,
      command: ["php", "artisan", "tinker", "--execute=[ephemeral-script]"],
      transactionMode: options.transactionMode,
      databaseWriteDetected: inspection.databaseWriteDetected,
      codeSha256: sha256(options.code),
      parsedResult: options.outputMode === "json" ? parsedResult : undefined,
      ...sanitized,
      stdout: options.outputMode === "json"
        ? JSON.stringify(parsedResult ?? null, null, 2)
        : sanitized.stdout,
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function loadApprovedSecretValues(projectName: string, cwd: string): Promise<string[]> {
  const project = await getProject(projectName);
  const resolved = await resolveProjectPath(projectName, cwd);
  await assertNoSymlinkEscape(resolved.root, resolved.absolutePath);
  return readSelectedDotEnvValues(
    path.join(resolved.absolutePath, ".env"),
    project.allowedSecretEnvKeys,
  );
}

export async function localSecretOperation(options: {
  project: string;
  cwd: string;
  envKey: string;
  operation: "hmac_sha256" | "hmac_sha1" | "sha256" | "presence_check";
  payload?: string;
  outputEncoding: "hex" | "hex_with_algorithm_prefix";
}): Promise<{ success: true; secretPresent: boolean; result?: string }> {
  const project = await getProject(options.project);
  if (!project.allowedSecretEnvKeys.includes(options.envKey)) {
    throw new Error(
      `Environment key '${options.envKey}' is not approved for in-memory operations in this project's LocalDev MCP configuration.`,
    );
  }

  const resolved = await resolveProjectPath(options.project, options.cwd);
  await assertNoSymlinkEscape(resolved.root, resolved.absolutePath);
  const envPath = path.join(resolved.absolutePath, ".env");
  const secretText = await readDotEnvValue(envPath, options.envKey);
  const secretPresent = secretText !== null && secretText.length > 0;

  if (options.operation === "presence_check") {
    return { success: true, secretPresent };
  }
  if (!secretPresent || secretText === null) {
    throw new Error(`Approved environment key '${options.envKey}' is not present or is empty.`);
  }

  const payload = options.payload ?? "";
  const secretBuffer = Buffer.from(secretText, "utf8");
  try {
    let digest: string;
    let prefix: string;
    if (options.operation === "hmac_sha256") {
      digest = createHmac("sha256", secretBuffer).update(payload, "utf8").digest("hex");
      prefix = "sha256=";
    } else if (options.operation === "hmac_sha1") {
      digest = createHmac("sha1", secretBuffer).update(payload, "utf8").digest("hex");
      prefix = "sha1=";
    } else {
      digest = createHash("sha256").update(payload, "utf8").digest("hex");
      prefix = "sha256=";
    }

    return {
      success: true,
      secretPresent: true,
      result: options.outputEncoding === "hex_with_algorithm_prefix" ? `${prefix}${digest}` : digest,
    };
  } finally {
    secretBuffer.fill(0);
  }
}

export async function localHttpRequest(options: {
  project: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutSeconds: number;
  followRedirects: boolean;
  expectedStatuses?: number[];
  redactHeaders?: string[];
}): Promise<Record<string, unknown>> {
  await getProject(options.project);
  const allowedHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const redirects: Array<{ status: number; from: string; to: string }> = [];
  const startedAt = Date.now();
  let currentUrl = options.url;
  let response: Response | null = null;
  let resolvedAddresses: string[] = [];

  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const validated = await validateLocalUrl(currentUrl, allowedHosts);
    resolvedAddresses = validated.addresses;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutSeconds * 1000);
    try {
      response = await fetch(validated.url, {
        method: options.method,
        headers: options.headers,
        body: options.method === "GET" || options.method === "HEAD" ? undefined : options.body,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location || !options.followRedirects) break;
    if (redirectCount === 5) throw new Error("Local HTTP redirect limit exceeded.");
    const nextUrl = new URL(location, validated.url).toString();
    await validateLocalUrl(nextUrl, allowedHosts);
    redirects.push({ status: response.status, from: currentUrl, to: nextUrl });
    currentUrl = nextUrl;
  }

  if (response === null) throw new Error("Local HTTP request did not produce a response.");
  const rawBody = await response.text();
  if (rawBody.length > 1_000_000) throw new Error("Local HTTP response exceeded the 1 MB safety limit.");
  const expected = options.expectedStatuses ?? [];
  const assertionPassed = expected.length === 0 || expected.includes(response.status);
  const sensitiveHeaders = new Set([
    "authorization",
    "x-hub-signature-256",
    "cookie",
    "set-cookie",
    "x-api-key",
    ...(options.redactHeaders ?? []).map((header) => header.toLowerCase()),
  ]);
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    responseHeaders[name] = sensitiveHeaders.has(name.toLowerCase()) ? "[REDACTED]" : redactSecrets(value);
  });

  return {
    status: response.status,
    ok: response.ok,
    assertionPassed,
    expectedStatuses: expected,
    headers: responseHeaders,
    body: truncate(redactSecrets(rawBody), 1_000_000),
    durationMs: Date.now() - startedAt,
    resolvedTarget: {
      url: currentUrl,
      addresses: resolvedAddresses,
    },
    redirectHistory: redirects,
    requestHeaderNames: Object.keys(options.headers ?? {}),
  };
}

export async function laravelDatabaseSnapshot(options: {
  project: string;
  cwd: string;
  query: DatabaseSnapshotInput;
  timeoutSeconds: number;
}): Promise<DatabaseSnapshotResult> {
  validateDatabaseQuery(options.query);
  const encoded = Buffer.from(JSON.stringify({
    ...options.query,
    columns: options.query.columns ?? ["*"],
    where: options.query.where ?? {},
    limit: options.query.limit ?? 20,
  }), "utf8").toString("base64");
  const code = `
$spec = json_decode(base64_decode('${encoded}'), true, 512, JSON_THROW_ON_ERROR);
$query = Illuminate\\Support\\Facades\\DB::table($spec['table']);
foreach ($spec['where'] as $column => $value) { $query->where($column, $value); }
$count = (clone $query)->count();
if (isset($spec['orderBy']['column'])) { $query->orderBy($spec['orderBy']['column'], $spec['orderBy']['direction'] ?? 'asc'); }
$rows = $query->limit($spec['limit'])->get($spec['columns'])->map(fn ($row) => (array) $row)->all();
return ['table' => $spec['table'], 'count' => $count, 'rows' => $rows];
`;
  const result = await executeLaravelTinker({
    project: options.project,
    cwd: options.cwd,
    code,
    timeoutSeconds: options.timeoutSeconds,
    transactionMode: "none",
    outputMode: "json",
    allowDatabaseWrite: false,
  });
  const parsed = result.parsedResult;
  if (!isRecord(parsed) || typeof parsed.count !== "number" || !Array.isArray(parsed.rows)) {
    throw new Error("Laravel database snapshot did not return the expected structured result.");
  }

  return {
    table: String(parsed.table),
    count: parsed.count,
    rows: parsed.rows.filter(isRecord),
  };
}

export async function laravelDatabaseAssert(options: {
  project: string;
  cwd: string;
  query: DatabaseSnapshotInput;
  assertion: "count_equals" | "exists" | "not_exists" | "column_equals" | "json_path_equals";
  expected?: unknown;
  column?: string;
  jsonPath?: string;
  timeoutSeconds: number;
}): Promise<Record<string, unknown>> {
  const snapshot = await laravelDatabaseSnapshot({
    project: options.project,
    cwd: options.cwd,
    query: options.query,
    timeoutSeconds: options.timeoutSeconds,
  });
  let actual: unknown;
  let passed = false;

  if (options.assertion === "count_equals") {
    actual = snapshot.count;
    passed = actual === options.expected;
  } else if (options.assertion === "exists") {
    actual = snapshot.count > 0;
    passed = actual === true;
  } else if (options.assertion === "not_exists") {
    actual = snapshot.count === 0;
    passed = actual === true;
  } else if (options.assertion === "column_equals") {
    assertIdentifier(options.column ?? "", "column");
    actual = snapshot.rows[0]?.[options.column ?? ""];
    passed = deepEqual(actual, options.expected);
  } else {
    if (!options.jsonPath || !/^[A-Za-z0-9_.-]{1,240}$/.test(options.jsonPath)) {
      throw new Error("jsonPath is required and must contain only safe dot-path characters.");
    }
    const root = options.column ? snapshot.rows[0]?.[options.column] : snapshot.rows[0];
    actual = dataGet(root, options.jsonPath);
    passed = deepEqual(actual, options.expected);
  }

  return {
    passed,
    assertion: options.assertion,
    expected: options.expected,
    actual,
    snapshot,
  };
}

function buildTinkerSnippet(
  code: string,
  transactionMode: TinkerTransactionMode,
  resultMarker: string,
  endMarker: string,
): string {
  const begin = transactionMode === "none"
    ? ""
    : "Illuminate\\Support\\Facades\\DB::beginTransaction(); $__localdevTransactionOpen = true;";
  const finish = transactionMode === "rollback"
    ? "Illuminate\\Support\\Facades\\DB::rollBack(); $__localdevTransactionOpen = false;"
    : transactionMode === "commit"
      ? "Illuminate\\Support\\Facades\\DB::commit(); $__localdevTransactionOpen = false;"
      : "";

  return `<?php
$__localdevTransactionOpen = false;
try {
    ${begin}
    $__localdevResult = (static function () {
${indent(code, 8)}
    })();
    ${finish}
    echo "\\n${resultMarker}" . json_encode($__localdevResult, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "${endMarker}\\n";
} catch (\\Throwable $__localdevError) {
    if ($__localdevTransactionOpen) {
        Illuminate\\Support\\Facades\\DB::rollBack();
    }
    fwrite(STDERR, "LOCALDEV_TINKER_ERROR: " . $__localdevError->getMessage() . "\\n");
    throw $__localdevError;
}
`;
}

function extractMarkedJson(stdout: string, startMarker: string, endMarker: string): unknown {
  const start = stdout.lastIndexOf(startMarker);
  if (start < 0) return undefined;
  const contentStart = start + startMarker.length;
  const end = stdout.indexOf(endMarker, contentStart);
  if (end < 0) return undefined;
  try {
    return JSON.parse(stdout.slice(contentStart, end));
  } catch {
    return undefined;
  }
}

async function readDotEnvValue(envPath: string, key: string): Promise<string | null> {
  const values = await readDotEnv(envPath);
  return values.get(key) ?? null;
}

async function readSelectedDotEnvValues(envPath: string, keys: string[]): Promise<string[]> {
  const values = await readDotEnv(envPath);
  return [...new Set(keys.map((key) => values.get(key)).filter((value): value is string => typeof value === "string" && value.length >= 4))]
    .sort((a, b) => b.length - a.length);
}

async function readDotEnv(envPath: string): Promise<Map<string, string>> {
  let raw: string;
  try {
    raw = await readFile(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }

  const values = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    values.set(key, decodeDotEnvValue(trimmed.slice(separator + 1).trim()));
  }
  return values;
}

function decodeDotEnvValue(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1)
      .replaceAll("\\n", "\n")
      .replaceAll("\\r", "\r")
      .replaceAll("\\\"", '"')
      .replaceAll("\\\\", "\\");
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  const commentIndex = value.search(/\s+#/);
  return (commentIndex >= 0 ? value.slice(0, commentIndex) : value).trim();
}

async function validateLocalUrl(rawUrl: string, allowedHosts: Set<string>): Promise<{ url: string; addresses: string[] }> {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Local HTTP requests support only http:// and https:// URLs.");
  }
  if (url.username || url.password) throw new Error("Credentials in local HTTP URLs are blocked.");
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (!allowedHosts.has(hostname)) {
    throw new Error(`HTTP host '${hostname}' is not approved for this project.`);
  }

  const addresses = isIP(hostname)
    ? [hostname]
    : (await lookup(hostname, { all: true, verbatim: true })).map((item) => item.address);
  if (addresses.length === 0 || addresses.some((address) => !isLoopbackAddress(address))) {
    throw new Error(`HTTP host '${hostname}' did not resolve exclusively to loopback addresses.`);
  }

  return { url: url.toString(), addresses };
}

function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  return normalized === "::1"
    || normalized.startsWith("127.")
    || normalized.startsWith("::ffff:127.");
}

function sanitizeProcessOutput<T extends ProcessOutput>(result: T, secretValues: string[] = []): T {
  return {
    ...result,
    stdout: redactKnownValues(redactSecrets(result.stdout), secretValues),
    stderr: redactKnownValues(redactSecrets(result.stderr), secretValues),
  };
}

export function redactKnownValues(text: string, secretValues: string[]): string {
  let redacted = text;
  for (const value of secretValues) {
    if (value.length < 4) continue;
    redacted = redacted.split(value).join("[REDACTED_SECRET]");
  }
  return redacted;
}

function validateDatabaseQuery(query: DatabaseSnapshotInput): void {
  assertIdentifier(query.table, "table");
  for (const column of query.columns ?? []) {
    if (column !== "*") assertIdentifier(column, "column");
  }
  for (const column of Object.keys(query.where ?? {})) assertIdentifier(column, "where column");
  if (query.orderBy) assertIdentifier(query.orderBy.column, "orderBy column");
  const limit = query.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error("Database snapshot limit must be between 1 and 200.");
  }
}

function assertIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value)) {
    throw new Error(`${label} '${value}' is not a safe database identifier.`);
  }
}

function indent(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return value.split(/\r?\n/).map((line) => `${prefix}${line}`).join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dataGet(value: unknown, dotPath: string): unknown {
  let current = value;
  for (const segment of dotPath.split(".")) {
    if (typeof current === "string") {
      try {
        current = JSON.parse(current);
      } catch {
        return undefined;
      }
    }
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
