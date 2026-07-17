import { rm } from "node:fs/promises";
import path from "node:path";
import { createPatch } from "diff";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { validateCommand, validateGitBranchName } from "./security/command-policy.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  stderr: "pipe",
});

const client = new Client({
  name: "localdev-mcp-integration-smoke",
  version: "0.4.0",
});

type TextContentItem = {
  type?: unknown;
  text?: unknown;
};

async function call(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`${name} returned an MCP error: ${JSON.stringify(result.content)}`);
  }

  const content = Array.isArray(result.content)
    ? (result.content as TextContentItem[])
    : [];
  const textItem = content.find(
    (item) => item.type === "text" && typeof item.text === "string",
  );
  if (!textItem || typeof textItem.text !== "string") {
    throw new Error(`${name} did not return text content.`);
  }

  return JSON.parse(textItem.text) as Record<string, unknown>;
}

function expectBlockedGitCommand(args: string[]): void {
  let blocked = false;
  try {
    validateCommand("git", args);
  } catch {
    blocked = true;
  }
  if (!blocked) {
    throw new Error(`Expected guarded Git command to be blocked: git ${args.join(" ")}`);
  }
}

const firstPath = "logs/integration-smoke-a.txt";
const secondPath = "logs/integration-smoke-b.txt";

try {
  await client.connect(transport);

  const projects = await call("list_projects");
  const configuredProjects = Array.isArray(projects.projects)
    ? projects.projects as Array<Record<string, unknown>>
    : [];
  const skills = await call("list_skills");
  const installedSkills = Array.isArray(skills.skills)
    ? skills.skills as Array<Record<string, unknown>>
    : [];
  if (!installedSkills.some((skill) => skill.name === "frontend-craft-director")) {
    throw new Error("frontend-craft-director is not listed by list_skills.");
  }
  const frontendSkill = await call("get_skill", { name: "frontend-craft-director" });
  if (!String(frontendSkill.content ?? "").includes("Mandatory usage rule")) {
    throw new Error("get_skill did not return the frontend skill content.");
  }
  const visualQaReference = await call("read_skill_reference", {
    skill: "frontend-craft-director",
    reference: "references/visual-qa.md",
  });
  if (!String(visualQaReference.content ?? "").includes("Evidence levels")) {
    throw new Error("read_skill_reference did not return the visual QA reference.");
  }
  const projectInfo = await call("get_project_info", { project: "localdev-mcp" });
  const snapshot = await call("get_project_snapshot", { project: "localdev-mcp", forceRefresh: true });
  const safeBranch = "feature/integration-branch-policy";
  validateGitBranchName(safeBranch);
  validateCommand("git", ["switch", "-c", safeBranch]);
  validateCommand("git", ["switch", safeBranch]);
  validateCommand("git", ["checkout", "-b", safeBranch]);
  expectBlockedGitCommand(["checkout", "README.md"]);
  expectBlockedGitCommand(["checkout", "--", "README.md"]);
  expectBlockedGitCommand(["switch", "-C", safeBranch]);
  expectBlockedGitCommand(["switch", "-c", "../unsafe"]);
  const branchPlan = await call("git_switch_branch", {
    project: "localdev-mcp",
    branch: safeBranch,
    create: true,
    requireClean: false,
    expectedHead: String(snapshot.gitHead),
    dryRun: true,
  });
  if (branchPlan.dryRun !== true) throw new Error("git_switch_branch dry-run failed.");
  if (JSON.stringify(branchPlan.command) !== JSON.stringify(["git", "switch", "-c", safeBranch])) {
    throw new Error("git_switch_branch returned an unexpected command plan.");
  }
  const batchRead = await call("batch_read_files", {
    project: "localdev-mcp",
    files: [
      { path: "package.json", maxLines: 80 },
      { path: "src/lib/text.ts", maxLines: 120 },
      { path: "src/security/command-policy.ts", maxLines: 180 },
    ],
  });
  const search = await call("search_code", {
    project: "localdev-mcp",
    query: "registerTool",
    glob: "src/**/*.ts",
    maxResults: 20,
  });

  await call("create_file", {
    project: "localdev-mcp",
    path: firstPath,
    content: "alpha\n",
    createParents: true,
  });
  await call("create_file", {
    project: "localdev-mcp",
    path: secondPath,
    content: "one\n",
    createParents: true,
  });

  const temporaryFiles = await call("batch_read_files", {
    project: "localdev-mcp",
    files: [
      { path: firstPath, maxLines: 20 },
      { path: secondPath, maxLines: 20 },
    ],
  });
  const temporaryResults = temporaryFiles.results as Array<Record<string, unknown>>;

  const replaced = await call("replace_text", {
    project: "localdev-mcp",
    path: firstPath,
    oldText: "alpha",
    newText: "beta",
    expectedSha256: String(temporaryResults[0]?.sha256),
    expectedOccurrences: 1,
  });

  const firstAfterReplace = await call("read_file", {
    project: "localdev-mcp",
    path: firstPath,
    maxLines: 20,
  });
  const secondBeforePatch = await call("read_file", {
    project: "localdev-mcp",
    path: secondPath,
    maxLines: 20,
  });

  await call("batch_apply_patches", {
    project: "localdev-mcp",
    edits: [
      {
        path: firstPath,
        expectedSha256: String(firstAfterReplace.sha256),
        patch: createPatch(firstPath, "beta\n", "beta-fast\n"),
      },
      {
        path: secondPath,
        expectedSha256: String(secondBeforePatch.sha256),
        patch: createPatch(secondPath, "one\n", "two\n"),
      },
    ],
  });

  const changed = await call("inspect_changed_files", {
    project: "localdev-mcp",
    includeDiff: false,
  });
  const validation = await call("run_validation_plan", {
    project: "localdev-mcp",
    profile: "quick",
    npmScripts: ["typecheck"],
    timeoutSeconds: 300,
  });
  if (validation.passed !== true) throw new Error("run_validation_plan failed.");

  const finalTemporaryFiles = await call("batch_read_files", {
    project: "localdev-mcp",
    files: [
      { path: firstPath, maxLines: 20 },
      { path: secondPath, maxLines: 20 },
    ],
  });
  const finalResults = finalTemporaryFiles.results as Array<Record<string, unknown>>;
  await call("delete_file", {
    project: "localdev-mcp",
    path: firstPath,
    expectedSha256: String(finalResults[0]?.sha256),
  });
  await call("delete_file", {
    project: "localdev-mcp",
    path: secondPath,
    expectedSha256: String(finalResults[1]?.sha256),
  });

  console.log(JSON.stringify({
    ok: true,
    checks: [
      "list_projects",
      "list_skills",
      "get_skill",
      "read_skill_reference",
      "get_project_info",
      "get_project_snapshot",
      "guarded_git_branch_policy",
      "git_switch_branch",
      "batch_read_files",
      "search_code",
      "create_file",
      "replace_text",
      "batch_apply_patches",
      "inspect_changed_files",
      "run_validation_plan",
      "delete_file",
    ],
    projectCount: configuredProjects.length,
    detected: projectInfo.detected ?? null,
    snapshotCacheHit: snapshot.cacheHit ?? null,
    batchReadCount: Array.isArray(batchRead.results) ? batchRead.results.length : null,
    searchEngine: search.engine ?? null,
    replaceHash: replaced.sha256 ?? null,
    changedFiles: Array.isArray(changed.changedFiles) ? changed.changedFiles.length : null,
  }, null, 2));
} finally {
  await client.close();
  await Promise.allSettled([
    rm(path.resolve("logs/integration-smoke-a.txt"), { force: true }),
    rm(path.resolve("logs/integration-smoke-b.txt"), { force: true }),
  ]);
}
