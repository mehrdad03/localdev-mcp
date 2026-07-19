import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { appRoot } from "../config.js";
import { assertNoSymlinkEscape, resolveProjectPath } from "../security/path-guard.js";

const DEFAULT_MAX_IMPORT_BYTES = 100 * 1024 * 1024;
const MAX_CONFIGURED_IMPORT_BYTES = 1024 * 1024 * 1024;

const blockedSourceBasenames = [
  /^\.env(?:\..+)?$/i,
  /^auth\.json$/i,
  /^credentials(?:\..+)?$/i,
  /^id_rsa(?:\.pub)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
];

const extensionMimeTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
  ".zip": "application/zip",
};

export interface ImportFileToProjectInput {
  project: string;
  sourceFile: string;
  destination: string;
  overwrite: boolean;
  createParents: boolean;
  expectedSha256?: string;
}

export interface ImportFileToProjectResult {
  path: string;
  size: number;
  mimeType: string;
  sha256: string;
  overwritten: boolean;
}

export async function importFileToProject(
  input: ImportFileToProjectInput,
): Promise<ImportFileToProjectResult> {
  const source = await resolveApprovedSourceFile(input.sourceFile);
  const destination = await resolveProjectPath(input.project, input.destination);
  await assertNoSymlinkEscape(destination.root, destination.absolutePath);
  await assertSafeDestinationAncestors(destination.root, destination.absolutePath);

  const destinationParent = path.dirname(destination.absolutePath);
  const destinationExists = await pathExists(destination.absolutePath);
  let destinationHash: string | null = null;
  let backupPath: string | null = null;

  if (destinationExists) {
    const destinationStat = await lstat(destination.absolutePath);
    if (destinationStat.isSymbolicLink()) throw new Error("Destination may not be a symbolic link.");
    if (!destinationStat.isFile()) throw new Error("Destination exists but is not a regular file.");
    if (!input.overwrite) throw new Error("Destination already exists and overwrite=false.");
    destinationHash = await sha256File(destination.absolutePath);
    if (input.expectedSha256 && destinationHash !== input.expectedSha256.toLowerCase()) {
      throw new Error("Destination changed since expectedSha256 was recorded.");
    }
  } else if (input.expectedSha256) {
    throw new Error("expectedSha256 can be used only when overwriting an existing destination.");
  }

  if (input.createParents) {
    await mkdir(destinationParent, { recursive: true });
  } else {
    const parentStat = await stat(destinationParent).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw new Error("Destination parent does not exist and createParents=false.");
      throw error;
    });
    if (!parentStat.isDirectory()) throw new Error("Destination parent is not a directory.");
  }

  await assertSafeDestinationAncestors(destination.root, destination.absolutePath);
  const temporaryPath = path.join(
    destinationParent,
    `.${path.basename(destination.absolutePath)}.localdev-import-${randomUUID()}.tmp`,
  );

  try {
    const copiedHash = await copyAndHash(source.realPath, temporaryPath);
    if (copiedHash !== source.sha256) {
      throw new Error("Imported file hash changed while copying.");
    }

    if (destinationExists) {
      backupPath = await backupBinaryFile(input.project, destination.relativePath, destination.absolutePath);
      await unlink(destination.absolutePath);
    }

    try {
      await rename(temporaryPath, destination.absolutePath);
    } catch (error) {
      if (backupPath && !(await pathExists(destination.absolutePath))) {
        await copyFile(backupPath, destination.absolutePath);
      }
      throw error;
    }

    const finalHash = await sha256File(destination.absolutePath);
    if (finalHash !== source.sha256) {
      if (backupPath) {
        await copyFile(backupPath, destination.absolutePath);
      } else {
        await rm(destination.absolutePath, { force: true });
      }
      throw new Error("Destination hash verification failed after import.");
    }

    return {
      path: destination.relativePath,
      size: source.size,
      mimeType: source.mimeType,
      sha256: finalHash,
      overwritten: destinationExists,
    };
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function detectMimeType(filePath: string): Promise<string> {
  const file = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(1024);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead);

    if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return "image/png";
    }
    if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
      return "image/jpeg";
    }
    if (
      header.length >= 12
      && header.subarray(0, 4).toString("ascii") === "RIFF"
      && header.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      return "image/webp";
    }
    if (header.length >= 5 && header.subarray(0, 5).toString("ascii") === "%PDF-") {
      return "application/pdf";
    }
    if (header.length >= 6 && (header.subarray(0, 6).toString("ascii") === "GIF87a" || header.subarray(0, 6).toString("ascii") === "GIF89a")) {
      return "image/gif";
    }

    const textHeader = header.toString("utf8").replace(/^\uFEFF/, "").trimStart();
    if (/^(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[^]*?-->\s*)*<svg\b/i.test(textHeader)) {
      return "image/svg+xml";
    }
  } finally {
    await file.close();
  }

  return extensionMimeTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(
    createReadStream(filePath),
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback();
      },
    }),
  );
  return hash.digest("hex");
}

async function resolveApprovedSourceFile(sourceFile: string): Promise<{
  realPath: string;
  size: number;
  mimeType: string;
  sha256: string;
}> {
  if (!sourceFile || sourceFile.includes("\0")) throw new Error("source_file is empty or invalid.");
  if (!path.isAbsolute(sourceFile)) throw new Error("source_file must be an absolute mounted file path.");

  const sourceStat = await lstat(sourceFile);
  if (sourceStat.isSymbolicLink()) throw new Error("source_file may not be a symbolic link.");
  if (!sourceStat.isFile()) throw new Error("source_file is not a regular file.");
  if (blockedSourceBasenames.some((pattern) => pattern.test(path.basename(sourceFile)))) {
    throw new Error("Secret-like source files may not be imported.");
  }

  const sourceRealPath = await realpath(sourceFile);
  const allowedRoots = await getAllowedImportRoots();
  if (!allowedRoots.some((root) => isPathInside(root, sourceRealPath))) {
    throw new Error(
      "source_file is outside approved import roots. Configure LOCALDEV_MCP_IMPORT_ROOTS for the tunnel mount directory.",
    );
  }

  const maxBytes = getMaxImportBytes();
  if (sourceStat.size > maxBytes) {
    throw new Error(`source_file exceeds the ${maxBytes}-byte import limit.`);
  }

  const [mimeType, sha256] = await Promise.all([
    detectMimeType(sourceRealPath),
    sha256File(sourceRealPath),
  ]);

  return {
    realPath: sourceRealPath,
    size: sourceStat.size,
    mimeType,
    sha256,
  };
}

async function getAllowedImportRoots(): Promise<string[]> {
  const configured = process.env.LOCALDEV_MCP_IMPORT_ROOTS
    ?.split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
  const candidates = configured && configured.length > 0
    ? configured
    : [os.tmpdir(), process.env.TEMP, process.env.TMP, process.env.TMPDIR].filter((value): value is string => Boolean(value));

  const roots: string[] = [];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    const actual = await realpath(resolved).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (actual && !roots.some((root) => samePath(root, actual))) roots.push(actual);
  }
  if (roots.length === 0) throw new Error("No approved import root is available.");
  return roots;
}

async function assertSafeDestinationAncestors(root: string, destination: string): Promise<void> {
  const rootReal = await realpath(root);
  const relative = path.relative(root, destination);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Destination escaped the configured project root.");
  }

  const segments = relative.split(path.sep).filter(Boolean);
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index] as string);
    const currentStat = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!currentStat) break;
    if (currentStat.isSymbolicLink()) throw new Error("Destination path contains a symbolic link.");
    if (index < segments.length - 1 && !currentStat.isDirectory()) {
      throw new Error("Destination path contains a non-directory ancestor.");
    }
  }

  const parent = path.dirname(destination);
  const parentReal = await realpath(parent).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (parentReal && !isPathInside(rootReal, parentReal)) {
    throw new Error("Destination parent resolved outside the configured project root.");
  }
}

async function copyAndHash(source: string, destination: string): Promise<string> {
  const hash = createHash("sha256");
  const hashingStream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    createReadStream(source),
    hashingStream,
    createWriteStream(destination, { flags: "wx" }),
  );
  return hash.digest("hex");
}

async function backupBinaryFile(project: string, relativePath: string, absolutePath: string): Promise<string> {
  const safeName = `${Date.now()}-${randomUUID()}-${path.basename(relativePath)}`;
  const backupPath = path.join(appRoot, "logs", "backups", project, safeName);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await copyFile(absolutePath, backupPath);
  return backupPath;
}

function getMaxImportBytes(): number {
  const raw = process.env.LOCALDEV_MCP_MAX_IMPORT_BYTES?.trim();
  if (!raw) return DEFAULT_MAX_IMPORT_BYTES;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_CONFIGURED_IMPORT_BYTES) {
    throw new Error(
      `LOCALDEV_MCP_MAX_IMPORT_BYTES must be an integer between 1 and ${MAX_CONFIGURED_IMPORT_BYTES}.`,
    );
  }
  return parsed;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
