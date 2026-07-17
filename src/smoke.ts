import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  stderr: "pipe",
});

const client = new Client({
  name: "localdev-mcp-smoke",
  version: "0.3.1",
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
  "git_diff",
  "git_status",
  "git_switch_branch",
  "inspect_changed_files",
  "inspect_database_schema",
  "inspect_routes",
  "list_directory",
  "list_projects",
  "npm_install",
  "read_file",
  "read_laravel_logs",
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
  "write_file",
].sort();

try {
  await client.connect(transport);
  const result = await client.listTools();
  const names = result.tools.map((tool) => tool.name).sort();
  const missing = expectedTools.filter((name) => !names.includes(name));
  const unexpected = names.filter((name) => !expectedTools.includes(name));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(`Tool registration mismatch. Missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}`);
  }
  console.log(JSON.stringify({ count: names.length, tools: names, ok: true }, null, 2));
} finally {
  await client.close();
}
