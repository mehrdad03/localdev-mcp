import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  stderr: "pipe",
});
const client = new Client({ name: "localdev-mcp-benchmark", version: "0.3.0" });

type TextContentItem = { type?: unknown; text?: unknown };

async function call(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.content)}`);
  const item = (Array.isArray(result.content) ? result.content : [])
    .find((entry) => (entry as TextContentItem).type === "text") as TextContentItem | undefined;
  if (!item || typeof item.text !== "string") throw new Error(`${name} returned no text result.`);
  return JSON.parse(item.text) as Record<string, unknown>;
}

async function measure<T>(task: () => Promise<T>): Promise<{ durationMs: number; value: T }> {
  const startedAt = performance.now();
  const value = await task();
  return { durationMs: Math.round(performance.now() - startedAt), value };
}

const files = [
  "package.json",
  "README.md",
  "src/index.ts",
  "src/lib/process.ts",
  "src/lib/text.ts",
  "src/security/command-policy.ts",
];

try {
  await client.connect(transport);

  const sequential = await measure(async () => {
    for (const file of files) {
      await call("read_file", { project: "localdev-mcp", path: file, maxLines: 120 });
    }
  });

  const batch = await measure(async () => {
    await call("batch_read_files", {
      project: "localdev-mcp",
      files: files.map((file) => ({ path: file, maxLines: 120 })),
      concurrency: 6,
    });
  });

  const snapshotCold = await measure(() => call("get_project_snapshot", {
    project: "localdev-mcp",
    forceRefresh: true,
  }));
  const snapshotWarm = await measure(() => call("get_project_snapshot", {
    project: "localdev-mcp",
    forceRefresh: false,
  }));
  const search = await measure(() => call("search_code", {
    project: "localdev-mcp",
    query: "registerTool",
    glob: "src/**/*.ts",
    maxResults: 100,
  }));

  const speedup = batch.durationMs > 0
    ? Number((sequential.durationMs / batch.durationMs).toFixed(2))
    : null;
  const snapshotSpeedup = snapshotWarm.durationMs > 0
    ? Number((snapshotCold.durationMs / snapshotWarm.durationMs).toFixed(2))
    : null;

  console.log(JSON.stringify({
    ok: true,
    files: files.length,
    sequentialReadMs: sequential.durationMs,
    batchReadMs: batch.durationMs,
    batchReadSpeedup: speedup,
    snapshotColdMs: snapshotCold.durationMs,
    snapshotWarmMs: snapshotWarm.durationMs,
    snapshotCacheSpeedup: snapshotSpeedup,
    searchMs: search.durationMs,
    searchEngine: search.value.engine ?? null,
  }, null, 2));
} finally {
  await client.close();
}
