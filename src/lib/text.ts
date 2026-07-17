import { createHash } from "node:crypto";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function textResult(data: unknown) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return {
    content: [{ type: "text" as const, text }],
  };
}

export function truncate(text: string, maxChars = 60_000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[output truncated after ${maxChars} characters]`;
}

export function redactSecrets(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_API_KEY]")
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\b\s*[:=]\s*([^\s,;]+)/gi,
      "$1=[REDACTED]",
    );
}
