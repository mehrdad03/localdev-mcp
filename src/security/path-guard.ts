import path from "node:path";
import { lstat } from "node:fs/promises";
import { getProject } from "../config.js";

const blockedSegments = new Set([
  ".git",
  ".ssh",
  "node_modules",
  "vendor",
  "storage/framework/sessions",
]);

const blockedBasenames = [
  /^\.env(?:\..+)?$/i,
  /^auth\.json$/i,
  /^credentials(?:\..+)?$/i,
  /^id_rsa(?:\.pub)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
];

function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

export function assertSafeRelativePath(relativePath: string): void {
  if (!relativePath || relativePath.includes("\0")) {
    throw new Error("Path is empty or invalid.");
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error("Only project-relative paths are allowed.");
  }

  const normalized = normalizeSlashes(relativePath).replace(/^\.\//, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "..")) {
    throw new Error("Parent-directory traversal is not allowed.");
  }

  const joined = segments.join("/").toLowerCase();
  for (const blocked of blockedSegments) {
    if (joined === blocked || joined.startsWith(`${blocked}/`)) {
      throw new Error(`Access to '${blocked}' is blocked.`);
    }
  }

  const basename = segments.at(-1) ?? "";
  if (blockedBasenames.some((pattern) => pattern.test(basename))) {
    throw new Error(`Access to secret-like file '${basename}' is blocked.`);
  }
}

export async function resolveProjectPath(
  projectName: string,
  relativePath = ".",
): Promise<{ root: string; absolutePath: string; relativePath: string }> {
  assertSafeRelativePath(relativePath);
  const project = await getProject(projectName);
  const root = path.resolve(project.root);
  const absolutePath = path.resolve(root, relativePath);
  const relative = path.relative(root, absolutePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Resolved path is outside the configured project root.");
  }

  return {
    root,
    absolutePath,
    relativePath: normalizeSlashes(relative || "."),
  };
}

export async function assertNoSymlinkEscape(
  root: string,
  absolutePath: string,
): Promise<void> {
  try {
    const stat = await lstat(absolutePath);
    if (stat.isSymbolicLink()) {
      throw new Error("Direct access to symbolic links is blocked.");
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }

  const relative = path.relative(root, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escaped project root.");
  }
}

export const defaultIgnoreGlobs = [
  "**/.git/**",
  "**/.idea/**",
  "**/.vscode/**",
  "**/node_modules/**",
  "**/vendor/**",
  "**/storage/framework/**",
  "**/storage/logs/*.log",
  "**/bootstrap/cache/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/coverage/**",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx"
];
