import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { appRoot } from "../config.js";

interface CacheEnvelope<T> {
  fingerprint: string;
  createdAt: string;
  value: T;
}

const memoryCache = new Map<string, CacheEnvelope<unknown>>();

export async function readJsonCache<T>(
  namespace: string,
  key: string,
  fingerprint: string,
): Promise<T | null> {
  const cacheKey = `${sanitize(namespace)}:${sanitize(key)}`;
  const memory = memoryCache.get(cacheKey) as CacheEnvelope<T> | undefined;
  if (memory?.fingerprint === fingerprint) return memory.value;

  const cachePath = resolveCachePath(namespace, key);
  try {
    const parsed = JSON.parse(await readFile(cachePath, "utf8")) as CacheEnvelope<T>;
    if (parsed.fingerprint !== fingerprint) return null;
    memoryCache.set(cacheKey, parsed as CacheEnvelope<unknown>);
    return parsed.value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

export async function writeJsonCache<T>(
  namespace: string,
  key: string,
  fingerprint: string,
  value: T,
): Promise<void> {
  const envelope: CacheEnvelope<T> = {
    fingerprint,
    createdAt: new Date().toISOString(),
    value,
  };
  const cachePath = resolveCachePath(namespace, key);
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(envelope), "utf8");
  memoryCache.set(`${sanitize(namespace)}:${sanitize(key)}`, envelope as CacheEnvelope<unknown>);
}

function resolveCachePath(namespace: string, key: string): string {
  return path.join(appRoot, "logs", "cache", sanitize(namespace), `${sanitize(key)}.json`);
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 160) || "default";
}
