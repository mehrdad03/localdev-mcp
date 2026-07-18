import type { ProjectConfig } from "../config.js";

export type OperationRisk =
  | "READ_ONLY"
  | "REVERSIBLE_LOCAL_WRITE"
  | "IRREVERSIBLE_LOCAL_WRITE"
  | "EXTERNAL_SIDE_EFFECT";

const builtInReadOnlyCommands = new Set([
  "about",
  "help",
  "list",
  "route:list",
  "migrate:status",
  "db:show",
  "db:table",
  "model:show",
  "queue:failed",
  "queue:monitor",
  "schedule:list",
  "config:show",
  "event:list",
  "env",
  "test",
]);

const reversibleLocalCommands = new Set([
  "optimize:clear",
  "cache:clear",
  "config:clear",
  "route:clear",
  "view:clear",
  "queue:restart",
  "storage:link",
]);

const irreversibleLocalCommands = new Set([
  "migrate",
  "migrate:fresh",
  "migrate:refresh",
  "migrate:reset",
  "migrate:rollback",
  "db:seed",
  "db:wipe",
  "queue:clear",
  "queue:flush",
  "schema:dump",
]);

const externalSideEffectCommands = new Set([
  "queue:work",
  "queue:listen",
  "schedule:run",
  "schedule:work",
  "horizon",
  "octane:start",
  "serve",
]);

export function classifyArtisanCommand(command: string, project: ProjectConfig): OperationRisk {
  const normalized = normalizeArtisanCommand(command);
  if (project.readOnlyArtisanCommands.includes(normalized)) return "READ_ONLY";
  if (builtInReadOnlyCommands.has(normalized)) return "READ_ONLY";
  if (reversibleLocalCommands.has(normalized)) return "REVERSIBLE_LOCAL_WRITE";
  if (irreversibleLocalCommands.has(normalized)) return "IRREVERSIBLE_LOCAL_WRITE";
  if (externalSideEffectCommands.has(normalized)) return "EXTERNAL_SIDE_EFFECT";

  // Unknown/custom commands are not assumed to be harmless. They require explicit
  // local-write approval unless the project configuration marks them read-only.
  return "REVERSIBLE_LOCAL_WRITE";
}

export function assertArtisanExecutionAllowed(options: {
  command: string;
  project: ProjectConfig;
  confirmWrite: boolean;
}): OperationRisk {
  const risk = classifyArtisanCommand(options.command, options.project);

  if (risk === "IRREVERSIBLE_LOCAL_WRITE") {
    throw new Error(
      `Artisan command '${options.command}' is classified as IRREVERSIBLE_LOCAL_WRITE and is blocked by LocalDev MCP.`,
    );
  }
  if (risk === "EXTERNAL_SIDE_EFFECT") {
    throw new Error(
      `Artisan command '${options.command}' may create a long-running process or external side effect and is blocked. Use a dedicated LocalDev MCP process tool where available.`,
    );
  }
  if (risk === "REVERSIBLE_LOCAL_WRITE" && !options.confirmWrite) {
    throw new Error(
      `Artisan command '${options.command}' is classified as REVERSIBLE_LOCAL_WRITE. Set confirmWrite=true only after reviewing the command.`,
    );
  }

  return risk;
}

export function normalizeArtisanCommand(command: string): string {
  const normalized = command.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,99}$/.test(normalized)) {
    throw new Error("Artisan command contains unsupported characters.");
  }
  return normalized;
}

export function buildArtisanArguments(
  command: string,
  positional: string[],
  options: Record<string, string | number | boolean | null | undefined>,
): string[] {
  const args = ["artisan", normalizeArtisanCommand(command)];

  for (const value of positional) {
    assertSafeCommandValue(value);
    args.push(value);
  }

  for (const [rawName, value] of Object.entries(options)) {
    const name = rawName.replace(/^--?/, "");
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(name)) {
      throw new Error(`Artisan option '${rawName}' is invalid.`);
    }
    if (name === "force" || name === "env") {
      throw new Error(`Artisan option '--${name}' is blocked by the safety policy.`);
    }
    if (value === false || value === null || value === undefined) continue;
    if (value === true) {
      args.push(`--${name}`);
      continue;
    }
    const normalizedValue = String(value);
    assertSafeCommandValue(normalizedValue);
    args.push(`--${name}=${normalizedValue}`);
  }

  return args;
}

function assertSafeCommandValue(value: string): void {
  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    throw new Error("Command values may not contain control characters.");
  }
  if (value.length > 1000) throw new Error("Command value exceeds the 1000-character limit.");
}

const blockedTinkerPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(exec|shell_exec|system|passthru|proc_open|popen)\s*\(/i, reason: "process execution" },
  { pattern: /\b(unlink|rmdir|chmod|chown|chgrp|file_put_contents|fopen|fwrite|copy|rename)\s*\(/i, reason: "filesystem mutation" },
  { pattern: /\b(file_get_contents|file|readfile|parse_ini_file|glob|scandir|opendir|readdir|realpath|stat|lstat)\s*\(/i, reason: "direct filesystem reading" },
  { pattern: /\b(base_path|app_path|config_path|database_path|resource_path|storage_path)\s*\(/i, reason: "application path access" },
  { pattern: /\b(File|Storage)\s*::/i, reason: "filesystem access" },
  { pattern: /\b(curl_exec|curl_init|fsockopen|pfsockopen|stream_socket_client)\s*\(/i, reason: "network access" },
  { pattern: /\b(eval|include|include_once|require|require_once)\b/i, reason: "dynamic code loading" },
  { pattern: /\b(getenv|putenv)\s*\(/i, reason: "environment access" },
  { pattern: /\benv\s*\(/i, reason: "environment access" },
  { pattern: /\$_(?:ENV|SERVER)\b/i, reason: "environment access" },
  { pattern: /(?:^|[\\/])\.env(?:\.|[\\/]|$)/i, reason: "secret-file access" },
  { pattern: /\b(Http|Mail|Notification)\s*::/i, reason: "external side effect" },
  { pattern: /\bArtisan\s*::\s*call\s*\(/i, reason: "nested Artisan execution" },
  { pattern: /\b(Process\s*::|new\s+Process\s*\(|Symfony\\Component\\Process)/i, reason: "process execution" },
  { pattern: /\b(dispatch|dispatchSync|event)\s*\(/i, reason: "queued or event side effect" },
  { pattern: /\bDB\s*::\s*(statement|unprepared|affectingStatement|select|selectOne|selectResultSets|scalar|cursor|connection)\s*\(/i, reason: "raw SQL or database connection access" },
  { pattern: /->\s*[A-Za-z0-9_]*Raw\s*\(/i, reason: "raw query expression" },
  { pattern: /\bDB\s*::\s*(beginTransaction|commit|rollBack)\s*\(/i, reason: "transaction control" },
  { pattern: /->\s*(beginTransaction|commit|rollBack)\s*\(/i, reason: "transaction control" },
  { pattern: /\bconfig\s*\(\s*\)/i, reason: "full configuration access" },
  { pattern: /\bconfig\s*\(\s*(?!['"])/i, reason: "dynamic configuration access" },
  { pattern: /\bconfig\s*\(\s*['"][^'"]*(?:secret|token|password|credential|api[_-]?key|app[_-]?key|database\.connections)[^'"]*['"]/i, reason: "secret configuration access" },
  { pattern: /\b(?:app|resolve)\s*\(\s*['"]config['"]\s*\)|\bConfig\s*::/i, reason: "configuration repository access" },
  { pattern: /->\s*getConfig\s*\(/i, reason: "connection configuration access" },
  { pattern: /\b(exit|die)\s*(?:\(|;)/i, reason: "premature process termination" },
];

const databaseWritePatterns = [
  /->\s*(create|createQuietly|update|updateQuietly|delete|deleteQuietly|destroy|forceDestroy|forceDelete|forceDeleteQuietly|restore|save|saveOrFail|saveQuietly|push|pushQuietly|touch|touchQuietly|increment|decrement|insert|insertGetId|insertOrIgnore|insertUsing|upsert|updateOrInsert|firstOrCreate|firstOrNew|updateOrCreate|incrementOrCreate|truncate|attach|detach|sync|syncWithoutDetaching|syncWithPivotValues|toggle|updateExistingPivot)\s*\(/i,
  /\bDB\s*::\s*(insert|update|delete)\s*\(/i,
  /\bSchema\s*::/i,
];

export function inspectTinkerCode(code: string): { databaseWriteDetected: boolean } {
  if (!code.trim()) throw new Error("Tinker code may not be empty.");
  if (code.length > 100_000) throw new Error("Tinker code exceeds the 100 KB safety limit.");

  for (const blocked of blockedTinkerPatterns) {
    if (blocked.pattern.test(code)) {
      throw new Error(`Tinker code is blocked because it contains ${blocked.reason}.`);
    }
  }

  return {
    databaseWriteDetected: databaseWritePatterns.some((pattern) => pattern.test(code)),
  };
}
