import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const allowedGitSubcommands = new Set([
  "init",
  "add",
  "commit",
  "checkout",
  "config",
  "status",
  "diff",
  "log",
  "show",
  "branch",
  "rev-parse",
  "ls-files",
  "grep",
  "switch",
]);

const allowedArtisanCommands = new Set([
  "about",
  "test",
  "route:list",
  "migrate:status",
  "db:show",
  "db:table",
  "model:show",
  "queue:failed",
  "queue:monitor",
  "queue:restart",
  "schedule:list",
  "config:show",
  "event:list",
  "optimize:clear",
  "cache:clear",
  "config:clear",
  "route:clear",
  "view:clear",
]);

const allowedComposerCommands = new Set([
  "validate",
  "show",
  "diagnose",
  "install",
  "dump-autoload",
  "test",
]);

const allowedNpmCommands = new Set(["run", "test", "install", "ci"]);

export type AllowedExecutable = "php" | "composer" | "npm" | "git";

export function validateCommand(
  executable: AllowedExecutable,
  args: string[],
): void {
  if (args.length > 40) throw new Error("Too many command arguments.");
  if (args.some((arg) => arg.includes("\0") || arg.includes("\n") || arg.includes("\r"))) {
    throw new Error("Command arguments may not contain control characters.");
  }

  if (args.some((arg) => /^--env=(?:production|prod)$/i.test(arg) || arg === "--force")) {
    throw new Error("Production and force flags are blocked.");
  }

  if (
    process.platform === "win32" &&
    (executable === "npm" || executable === "composer") &&
    args.some((arg) => /[&|<>^]/.test(arg))
  ) {
    throw new Error("Command arguments may not contain Windows shell operators.");
  }

  if (executable === "git") {
    const subcommand = args[0] ?? "";
    if (!allowedGitSubcommands.has(subcommand)) {
      throw new Error(`Git subcommand '${subcommand}' is not allowed.`);
    }
    if (subcommand === "switch") {
      validateGitSwitchArgs(args.slice(1));
    }
    if (subcommand === "checkout") {
      validateGitCheckoutArgs(args.slice(1));
    }
    return;
  }

  if (executable === "php") {
    const first = (args[0] ?? "").replaceAll("\\", "/");
    if (first === "artisan") {
      const command = args[1] ?? "";
      if (!allowedArtisanCommands.has(command)) {
        throw new Error(
          `Artisan command '${command}' is not allowed through the generic PHP command tool. ` +
          "Use laravel_run_artisan for reviewed project-specific commands or laravel_tinker_execute for guarded Laravel callbacks.",
        );
      }
      return;
    }
    if (first === "vendor/bin/pest" || first === "vendor/bin/phpunit") return;
    if (first === "-v" || first === "--version") return;
    throw new Error(
      "Arbitrary PHP execution is blocked. Use laravel_run_artisan, laravel_tinker_execute, " +
      "local_secret_operation, or local_http_request instead; php -r remains disabled.",
    );
  }

  if (executable === "composer") {
    const command = args[0] ?? "";
    if (!allowedComposerCommands.has(command)) {
      throw new Error(`Composer command '${command}' is not allowed.`);
    }
    return;
  }

  if (executable === "npm") {
    const command = args[0] ?? "";
    if (!allowedNpmCommands.has(command)) {
      throw new Error(`npm command '${command}' is not allowed.`);
    }
    if (command === "run" && !args[1]) {
      throw new Error("npm run requires a script name.");
    }
  }
}

export function validateGitBranchName(branch: string): void {
  if (!branch || branch.length > 240) {
    throw new Error("Git branch name must contain between 1 and 240 characters.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)) {
    throw new Error("Git branch name contains unsupported or unsafe characters.");
  }
  if (
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.includes("@{") ||
    branch.split("/").some((part) => part === "." || part.endsWith(".lock"))
  ) {
    throw new Error("Git branch name is not a safe branch reference.");
  }
}

function validateGitSwitchArgs(args: string[]): void {
  if (args.length === 1) {
    validateGitBranchName(args[0] ?? "");
    return;
  }
  if (args.length === 2 && (args[0] === "-c" || args[0] === "--create")) {
    validateGitBranchName(args[1] ?? "");
    return;
  }
  throw new Error("git switch is limited to '<branch>' or '-c <new-branch>'.");
}

function validateGitCheckoutArgs(args: string[]): void {
  if (args.length === 2 && args[0] === "-b") {
    validateGitBranchName(args[1] ?? "");
    return;
  }
  throw new Error("git checkout is limited to '-b <new-branch>'. Use git switch for existing branches.");
}

export function windowsExecutableName(executable: AllowedExecutable): string {
  if (process.platform !== "win32") return executable;
  if (executable === "php") {
    const configuredPhp = process.env.LOCALDEV_MCP_PHP?.trim();
    if (configuredPhp) return configuredPhp;

    const laragonPhpRoot = "C:\\laragon\\bin\\php";
    if (existsSync(laragonPhpRoot)) {
      const candidates = readdirSync(laragonPhpRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith("php-"))
        .map((entry) => path.join(laragonPhpRoot, entry.name, "php.exe"))
        .filter((candidate) => existsSync(candidate))
        .sort((a, b) => b.localeCompare(a));
      if (candidates[0]) return candidates[0];
    }

    return "php";
  }
  if (executable === "npm") return "npm.cmd";
  if (executable === "composer") return "composer.bat";
  return executable;
}
