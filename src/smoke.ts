import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  stderr: "pipe",
});

const client = new Client({
  name: "localdev-mcp-smoke",
  version: "0.6.0",
});

const expectedTools = [
  "apply_patch",
  "batch_apply_patches",
  "batch_read_files",
  "clear_laravel_cache",
  "composer_install",
  "create_file",
  "delete_file",
  "get_project_info",
  "get_project_snapshot",
  "get_project_tree",
  "get_skill",
  "git_diff",
  "git_status",
  "git_switch_branch",
  "inspect_changed_files",
  "inspect_database_schema",
  "inspect_local_process",
  "inspect_routes",
  "import_file_to_project",
  "laravel_database_assert",
  "laravel_database_snapshot",
  "laravel_run_artisan",
  "laravel_tinker_execute",
  "list_directory",
  "list_projects",
  "list_skills",
  "local_http_request",
  "local_secret_operation",
  "npm_install",
  "read_file",
  "read_laravel_logs",
  "read_skill_reference",
  "rename_file",
  "replace_text",
  "restart_queue_workers",
  "run_artisan",
  "run_build",
  "run_command",
  "run_eslint",
  "run_npm",
  "run_pest",
  "run_phpunit",
  "run_tests",
  "run_validation_plan",
  "search_code",
  "search_files",
  "start_local_process",
  "stop_local_process",
  "write_file",
].sort();

const oneHourTools = new Set([
  "composer_install",
  "laravel_database_assert",
  "laravel_database_snapshot",
  "laravel_run_artisan",
  "laravel_tinker_execute",
  "npm_install",
  "run_artisan",
  "run_build",
  "run_command",
  "run_eslint",
  "run_npm",
  "run_pest",
  "run_phpunit",
  "run_tests",
  "run_validation_plan",
]);

try {
  await client.connect(transport);
  const result = await client.listTools();
  const names = result.tools.map((tool) => tool.name).sort();
  const missing = expectedTools.filter((name) => !names.includes(name));
  const unexpected = names.filter((name) => !expectedTools.includes(name));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(`Tool registration mismatch. Missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}`);
  }

  type ToolInputSchema = {
    properties?: Record<string, { maximum?: unknown }>;
  };
  const timeoutTools = result.tools.flatMap((tool) => {
    const schema = tool.inputSchema as ToolInputSchema;
    const maximum = schema.properties?.timeoutSeconds?.maximum;
    return maximum === undefined ? [] : [{ name: tool.name, maximum }];
  });
  const unsafeTimeoutTools = timeoutTools.filter((tool) => typeof tool.maximum !== "number" || tool.maximum > 3600);
  const missingOneHourMaximum = timeoutTools.filter(
    (tool) => oneHourTools.has(tool.name) && tool.maximum !== 3600,
  );
  if (unsafeTimeoutTools.length > 0 || missingOneHourMaximum.length > 0) {
    throw new Error(`Command timeout schema mismatch: ${JSON.stringify({ unsafeTimeoutTools, missingOneHourMaximum })}`);
  }

  console.log(JSON.stringify({
    count: names.length,
    tools: names,
    timeoutMaximumSeconds: 3600,
    timeoutToolCount: timeoutTools.length,
    oneHourToolCount: oneHourTools.size,
    ok: true,
  }, null, 2));
} finally {
  await client.close();
}
