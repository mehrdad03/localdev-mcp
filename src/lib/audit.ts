import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { appRoot } from "../config.js";

const logDir = path.join(appRoot, "logs");
const logFile = path.join(logDir, "audit.log");

export async function audit(
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  await mkdir(logDir, { recursive: true });
  const entry = JSON.stringify({
    at: new Date().toISOString(),
    action,
    ...details,
  });
  await appendFile(logFile, `${entry}\n`, "utf8");
}
