import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { applyPatch } from "diff";
import fg from "fast-glob";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { appRoot, getProject, loadConfig, projectsFile } from "./config.js";
import { audit } from "./lib/audit.js";
import { readJsonCache, writeJsonCache } from "./lib/cache.js";
import { importFileToProject } from "./lib/file-import.js";
import { parseJsonDocument } from "./lib/json.js";
import {
  executeLaravelTinker,
  laravelDatabaseAssert,
  laravelDatabaseSnapshot,
  localHttpRequest,
  localSecretOperation,
  runLaravelProcess,
} from "./lib/laravel-integration.js";
import {
  inspectLocalProcess,
  startLaravelServer,
  stopLocalProcess,
} from "./lib/local-processes.js";
import { installFileInputSchemaAdvertising } from "./lib/mcp-file-schema.js";
import { runAllowedCommand, runGit } from "./lib/process.js";
import { searchWithRipgrep } from "./lib/ripgrep.js";
import { listInstalledSkills, loadSkill, loadSkillReference } from "./lib/skills.js";
import { redactSecrets, sha256, textResult } from "./lib/text.js";
import {
  defaultIgnoreGlobs,
  resolveProjectPath,
  assertNoSymlinkEscape,
} from "./security/path-guard.js";
import { type AllowedExecutable, validateGitBranchName } from "./security/command-policy.js";
import {
  assertArtisanExecutionAllowed,
  buildArtisanArguments,
} from "./security/laravel-policy.js";

const VERSION = "0.6.0";
const MAX_COMMAND_TIMEOUT_SECONDS = 60 * 60;

const server = new McpServer(
  { name: "LocalDev MCP", version: VERSION },
  {
    instructions:
      "Operate only inside configured projects. Prefer get_project_snapshot, batch_read_files, inspect_changed_files, replace_text, batch_apply_patches, and run_validation_plan to reduce tool round-trips without reducing safety. Use import_file_to_project for uploaded binary assets instead of Base64 or text writes. For frontend design, redesign, UI implementation, responsive fixes, interface audits, or rendered visual QA, load the installed frontend-craft-director skill with get_skill before changing project files and follow it as the governing workflow. For Laravel integration work, use the dedicated laravel_run_artisan, laravel_tinker_execute, local_secret_operation, local_http_request, database, and managed-process tools instead of trying to bypass the generic command policy. Read before writing, preserve SHA-256 checks, and prefer focused patches over full replacement. Never request secret files. Production flags, arbitrary shell commands, deployments, destructive Git operations, and unapproved database writes are blocked.",
  },
);

installFileInputSchemaAdvertising(server, {
  import_file_to_project: ["source_file"],
});

const projectNameSchema = z.string().min(1).describe("Project key from list_projects.");
const relativePathSchema = z
  .string()
  .default(".")
  .describe("Path relative to the selected project root. Absolute paths are rejected.");
const optionalCwdSchema = z
  .string()
  .optional()
  .describe("Optional project-relative working directory. When omitted, the tool auto-detects the relevant app root.");
const commandArgsSchema = z.array(z.string().max(500)).max(40).default([]);
const skillNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,79}$/)
  .describe("Installed skill name returned by list_skills.");
const skillReferenceSchema = z
  .string()
  .min(1)
  .max(240)
  .describe("Supporting file returned by get_skill, such as references/visual-qa.md.");
const artisanOptionValueSchema = z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]);
const databaseScalarSchema = z.union([z.string().max(20_000), z.number(), z.boolean(), z.null()]);
const databaseQuerySchema = z.object({
  table: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/),
  columns: z.array(z.string().regex(/^(?:\*|[A-Za-z_][A-Za-z0-9_]{0,127})$/)).max(50).optional(),
  where: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/), databaseScalarSchema).optional(),
  limit: z.number().int().min(1).max(200).default(20),
  orderBy: z.object({
    column: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/),
    direction: z.enum(["asc", "desc"]).default("asc"),
  }).optional(),
});

server.registerTool(
  "list_projects",
  {
    title: "List configured local projects",
    description: "Use this first to discover project keys, roots, stacks, and whether each root exists.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    const config = await loadConfig();
    const projects = await Promise.all(
      Object.entries(config.projects).map(async ([name, project]) => {
        let exists = false;
        try {
          exists = (await stat(project.root)).isDirectory();
        } catch {
          exists = false;
        }
        return { name, root: project.root, stack: project.stack, exists };
      }),
    );
    await audit("list_projects", { count: projects.length });
    return textResult({ projects });
  },
);

server.registerTool(
  "list_skills",
  {
    title: "List installed development skills",
    description:
      "Lists centrally installed LocalDev MCP skills with descriptions and their available references/templates. Use this when the user asks what workflows or skills are available.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    const skills = await listInstalledSkills();
    await audit("list_skills", { count: skills.length });
    return textResult({ skills });
  },
);

server.registerTool(
  "get_skill",
  {
    title: "Load an installed development skill",
    description:
      "Loads the complete governing instructions for one centrally installed skill. For frontend design, redesign, UI implementation, responsive fixes, interface audits, or visual QA, call get_skill with 'frontend-craft-director' before inspecting or editing the target project.",
    inputSchema: {
      name: skillNameSchema,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ name }) => {
    const skill = await loadSkill(name);
    await audit("get_skill", {
      name,
      sha256: skill.sha256,
      references: skill.references.length,
      templates: skill.templates.length,
    });
    return textResult(skill);
  },
);

server.registerTool(
  "read_skill_reference",
  {
    title: "Read a skill reference or template",
    description:
      "Reads one supporting file declared by get_skill from that skill's references/ or templates/ directory. Use progressive disclosure: load the main skill first, then read only the supporting file needed for the current task.",
    inputSchema: {
      skill: skillNameSchema,
      reference: skillReferenceSchema,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ skill, reference }) => {
    const result = await loadSkillReference(skill, reference);
    await audit("read_skill_reference", {
      skill,
      reference: result.reference,
      sha256: result.sha256,
    });
    return textResult(result);
  },
);

server.registerTool(
  "import_file_to_project",
  {
    title: "Import an uploaded file into an allowlisted project",
    description:
      "Copies a real uploaded file into a project without Base64 conversion. The source must come from an approved mounted-file root, and the destination is restricted to the selected project root.",
    inputSchema: {
      project: projectNameSchema,
      source_file: z.string().min(1).describe("Mounted upload path supplied by ChatGPT as a file input."),
      destination: z.string().min(1).describe("Project-relative destination path. Absolute paths and parent traversal are rejected."),
      overwrite: z.boolean().default(false),
      createParents: z.boolean().default(true),
      expectedSha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, source_file, destination, overwrite, createParents, expectedSha256 }) => {
    const result = await importFileToProject({
      project,
      sourceFile: source_file,
      destination,
      overwrite,
      createParents,
      expectedSha256,
    });
    await audit("import_file_to_project", {
      project,
      destination: result.path,
      size: result.size,
      mimeType: result.mimeType,
      sha256: result.sha256,
      overwritten: result.overwritten,
    });
    return textResult({
      path: result.path,
      size: result.size,
      mimeType: result.mimeType,
      sha256: result.sha256,
    });
  },
);

server.registerTool(
  "replace_text",
  {
    title: "Replace exact text safely in one file",
    description: "Performs a precise text replacement with SHA-256 verification, exact occurrence counting, backup, and no shell or script execution.",
    inputSchema: {
      project: projectNameSchema,
      path: z.string().min(1),
      oldText: z.string().min(1).max(500_000),
      newText: z.string().max(500_000),
      expectedSha256: z.string().length(64),
      expectedOccurrences: z.number().int().min(1).max(1000).default(1),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, path: relativePath, oldText, newText, expectedSha256, expectedOccurrences }) => {
    const resolved = await resolveProjectPath(project, relativePath);
    await assertNoSymlinkEscape(resolved.root, resolved.absolutePath);
    const current = await readFile(resolved.absolutePath, "utf8");
    if (sha256(current) !== expectedSha256) throw new Error("File changed since it was read. Read it again before replacing text.");
    if (oldText === newText) throw new Error("oldText and newText must differ.");
    const occurrences = countOccurrences(current, oldText);
    if (occurrences !== expectedOccurrences) {
      throw new Error(`Expected ${expectedOccurrences} occurrence(s), but found ${occurrences}. No changes were written.`);
    }
    const updated = current.split(oldText).join(newText);
    await backupFile(project, relativePath, resolved.absolutePath);
    await writeFile(resolved.absolutePath, updated, "utf8");
    await audit("replace_text", { project, relativePath, occurrences, oldHash: expectedSha256, newHash: sha256(updated) });
    return textResult({ project, path: relativePath, occurrences, sha256: sha256(updated), changed: true });
  },
);

server.registerTool(
  "batch_apply_patches",
  {
    title: "Apply verified patches to multiple files",
    description: "Verifies every file and patch before writing, creates backups, and rolls back written files if any batch write fails.",
    inputSchema: {
      project: projectNameSchema,
      edits: z.array(z.object({
        path: z.string().min(1),
        patch: z.string().min(1).max(1_000_000),
        expectedSha256: z.string().length(64),
      })).min(1).max(20),
      concurrency: z.number().int().min(1).max(8).default(6),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, edits, concurrency }) => {
    const uniquePaths = new Set(edits.map((edit) => normalizeSlashes(edit.path).toLowerCase()));
    if (uniquePaths.size !== edits.length) throw new Error("Each batch edit must target a unique file.");

    const prepared = await mapWithConcurrency(edits, concurrency, async (edit) => {
      const resolved = await resolveProjectPath(project, edit.path);
      await assertNoSymlinkEscape(resolved.root, resolved.absolutePath);
      const current = await readFile(resolved.absolutePath, "utf8");
      if (sha256(current) !== edit.expectedSha256) {
        throw new Error(`File changed since it was read: ${edit.path}`);
      }
      const updated = applyPatch(current, edit.patch);
      if (updated === false) throw new Error(`Patch could not be applied cleanly: ${edit.path}`);
      if (updated === current) throw new Error(`Patch produced no changes: ${edit.path}`);
      return { ...edit, absolutePath: resolved.absolutePath, current, updated };
    });

    for (const item of prepared) await backupFile(project, item.path, item.absolutePath);
    const written: typeof prepared = [];
    try {
      for (const item of prepared) {
        await writeFile(item.absolutePath, item.updated, "utf8");
        written.push(item);
      }
    } catch (error) {
      await Promise.allSettled(written.map((item) => writeFile(item.absolutePath, item.current, "utf8")));
      throw error;
    }

    const results = prepared.map((item) => ({
      path: item.path,
      oldSha256: item.expectedSha256,
      sha256: sha256(item.updated),
      changed: item.updated !== item.current,
    }));
    await audit("batch_apply_patches", { project, files: results.length });
    return textResult({ project, files: results.length, results });
  },
);

server.registerTool(
  "batch_read_files",
  {
    title: "Read multiple project files in parallel",
    description: "Reads up to 30 approved text files in one call, returning line-numbered content and SHA-256 hashes while preserving the same path and secret protections as read_file.",
    inputSchema: {
      project: projectNameSchema,
      files: z.array(z.object({
        path: z.string().min(1),
        startLine: z.number().int().min(1).default(1),
        endLine: z.number().int().min(1).max(100000).optional(),
        maxLines: z.number().int().min(1).max(2000).default(500),
      })).min(1).max(30),
      concurrency: z.number().int().min(1).max(8).default(6),
      maxTotalChars: z.number().int().min(10_000).max(1_500_000).default(300_000),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ project, files, concurrency, maxTotalChars }) => {
    const startedAt = Date.now();
    const readResults = await mapWithConcurrency(files, concurrency, async (file) => {
      const resolved = await resolveProjectPath(project, file.path);
      await assertNoSymlinkEscape(resolved.root, resolved.absolutePath);
      const fileStat = await stat(resolved.absolutePath);
      if (!fileStat.isFile()) throw new Error(`Requested path is not a file: ${file.path}`);
      if (fileStat.size > 5_000_000) throw new Error(`File exceeds the 5 MB read limit: ${file.path}`);
      const raw = await readFile(resolved.absolutePath, "utf8");
      const lines = raw.split(/\r?\n/);
      const finalEnd = Math.min(
        file.endLine ?? file.startLine + file.maxLines - 1,
        file.startLine + file.maxLines - 1,
        lines.length,
      );
      const content = lines
        .slice(file.startLine - 1, finalEnd)
        .map((line, index) => `${file.startLine + index}: ${line}`)
        .join("\n");
      return {
        path: file.path,
        sha256: sha256(raw),
        totalLines: lines.length,
        startLine: file.startLine,
        endLine: finalEnd,
        content,
      };
    });

    let remaining = maxTotalChars;
    const results = readResults.map((result) => {
      const content = result.content.slice(0, Math.max(0, remaining));
      remaining -= content.length;
      return { ...result, content, truncated: content.length < result.content.length };
    });
    await audit("batch_read_files", { project, files: files.length, durationMs: Date.now() - startedAt });
    return textResult({ project, durationMs: Date.now() - startedAt, results, outputTruncated: remaining <= 0 });
  },
);

server.registerTool(
  "get_project_info",
  {
    title: "Inspect project metadata and detected app roots",
    description: "Returns configured stack, Git branch, manifests, package scripts, and auto-detected Laravel, npm, and Composer working directories.",
    inputSchema: { project: projectNameSchema },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ project }) => {
    const config = await getProject(project);
    const root = path.resolve(config.root);
    const exists = await pathExists(root);
    if (!exists) throw new Error(`Configured root does not exist: ${root}`);

    const manifestPaths = await fg(
      ["composer.json", "package.json", "**/composer.json", "**/package.json"],
      {
        cwd: root,
        onlyFiles: true,
        dot: false,
        followSymbolicLinks: false,
        ignore: defaultIgnoreGlobs,
        deep: 5,
      },
    );
    manifestPaths.sort((a, b) => pathDepth(a) - pathDepth(b) || a.localeCompare(b));

    const manifests: Array<Record<string, unknown>> = [];
    for (const manifestPath of manifestPaths.slice(0, 25)) {
      try {
        const raw = await readFile(path.join(root, manifestPath), "utf8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        manifests.push({
          path: normalizeSlashes(manifestPath),
          type: path.basename(manifestPath) === "composer.json" ? "composer" : "npm",
          name: typeof parsed.name === "string" ? parsed.name : null,
          version: typeof parsed.version === "string" ? parsed.version : null,
          scripts:
            path.basename(manifestPath) === "package.json" && isRecord(parsed.scripts)
              ? Object.keys(parsed.scripts).sort()
              : undefined,
        });
      } catch {
        manifests.push({ path: normalizeSlashes(manifestPath), error: "Could not parse manifest." });
      }
    }

    const git = await runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const laravelCwd = await findMarkerCwd(project, "artisan");
    const npmCwd = await findMarkerCwd(project, "package.json");
    const composerCwd = await findMarkerCwd(project, "composer.json");

    await audit("get_project_info", { project, manifests: manifests.length });
    return textResult({
      project,
      root,
      stack: config.stack,
      exists,
      gitBranch: git.exitCode === 0 ? git.stdout.trim() : null,
      detected: { laravelCwd, npmCwd, composerCwd },
      manifests,
    });
  },
);

server.registerTool(
  "get_project_snapshot",
  {
    title: "Get a cached project development snapshot",
    description: "Returns branch, working-tree state, recent commits, detected app roots, manifests, important docs, and top-level structure in one cached call. Cache invalidates when Git HEAD or status changes.",
    inputSchema: {
      project: projectNameSchema,
      forceRefresh: z.boolean().default(false),
      maxDocuments: z.number().int().min(1).max(100).default(30),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ project, forceRefresh, maxDocuments }) => {
    const config = await getProject(project);
    const root = path.resolve(config.root);
    if (!(await pathExists(root))) throw new Error(`Configured root does not exist: ${root}`);

    const [head, branch, status, commits] = await Promise.all([
      runGit(root, ["rev-parse", "HEAD"]),
      runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
      runGit(root, ["status", "--porcelain=v1", "--untracked-files=normal"]),
      runGit(root, ["log", "-5", "--oneline", "--decorate"]),
    ]);
    const fingerprint = sha256([
      head.stdout.trim(),
      branch.stdout.trim(),
      status.stdout,
      config.root,
      JSON.stringify(config.stack),
    ].join("\n"));

    if (!forceRefresh) {
      const cached = await readJsonCache<Record<string, unknown>>("project-snapshot", project, fingerprint);
      if (cached) {
        await audit("get_project_snapshot", { project, cacheHit: true });
        return textResult({ ...cached, cacheHit: true });
      }
    }

    const [laravelCwd, npmCwd, composerCwd, manifestPaths, documentPaths, rootEntries] = await Promise.all([
      findMarkerCwd(project, "artisan"),
      findMarkerCwd(project, "package.json"),
      findMarkerCwd(project, "composer.json"),
      fg(["composer.json", "package.json", "**/composer.json", "**/package.json"], {
        cwd: root,
        onlyFiles: true,
        dot: false,
        followSymbolicLinks: false,
        ignore: defaultIgnoreGlobs,
        deep: 5,
      }),
      fg(["AGENTS.md", "README.md", "**/AGENTS.md", "**/README.md", "docs/**/*.md", "**/SPRINTS.md", "**/ARCHITECTURE_SUMMARY.md"], {
        cwd: root,
        onlyFiles: true,
        dot: false,
        followSymbolicLinks: false,
        ignore: defaultIgnoreGlobs,
        deep: 8,
      }),
      readdir(root, { withFileTypes: true }),
    ]);

    manifestPaths.sort((a, b) => pathDepth(a) - pathDepth(b) || a.localeCompare(b));
    documentPaths.sort((a, b) => pathDepth(a) - pathDepth(b) || a.localeCompare(b));
    const manifests = await mapWithConcurrency(manifestPaths.slice(0, 25), 6, async (manifestPath) => {
      try {
        const parsed = JSON.parse(await readFile(path.join(root, manifestPath), "utf8")) as Record<string, unknown>;
        return {
          path: normalizeSlashes(manifestPath),
          type: path.basename(manifestPath) === "composer.json" ? "composer" : "npm",
          name: typeof parsed.name === "string" ? parsed.name : null,
          version: typeof parsed.version === "string" ? parsed.version : null,
          scripts: path.basename(manifestPath) === "package.json" && isRecord(parsed.scripts)
            ? Object.keys(parsed.scripts).sort()
            : undefined,
        };
      } catch {
        return { path: normalizeSlashes(manifestPath), error: "Could not parse manifest." };
      }
    });

    const snapshot = {
      project,
      root,
      stack: config.stack,
      gitBranch: branch.exitCode === 0 ? branch.stdout.trim() : null,
      gitHead: head.exitCode === 0 ? head.stdout.trim() : null,
      gitStatus: status.stdout.trim() || "clean",
      recentCommits: commits.stdout.trim().split(/\r?\n/).filter(Boolean),
      detected: { laravelCwd, npmCwd, composerCwd },
      manifests,
      importantDocuments: documentPaths.slice(0, maxDocuments).map(normalizeSlashes),
      topLevel: rootEntries
        .filter((entry) => !isIgnoredRelativePath(entry.name))
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
        .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other" })),
      fingerprint,
    };
    await writeJsonCache("project-snapshot", project, fingerprint, snapshot);
    await audit("get_project_snapshot", { project, cacheHit: false, manifests: manifests.length });
    return textResult({ ...snapshot, cacheHit: false });
  },
);

server.registerTool(
  "get_project_tree",
  {
    title: "Get project directory tree",
    description: "Use this to inspect a project structure. Generated, dependency, secret, and cache directories are excluded.",
    inputSchema: {
      project: projectNameSchema,
      path: relativePathSchema,
      maxDepth: z.number().int().min(1).max(8).default(4),
      maxEntries: z.number().int().min(20).max(2000).default(500),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ project, path: relativePath, maxDepth, maxEntries }) => {
    const { root, absolutePath } = await resolveProjectPath(project, relativePath);
    await assertNoSymlinkEscape(root, absolutePath);

    const lines: string[] = [];
    async function walk(current: string, depth: number, prefix: string): Promise<void> {
      if (depth > maxDepth || lines.length >= maxEntries) return;
      const entries = await readdir(current, { withFileTypes: true });
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (lines.length >= maxEntries) return;
        const relative = normalizeSlashes(path.relative(root, path.join(current, entry.name)));
        if (isIgnoredRelativePath(relative)) continue;
        lines.push(`${prefix}${entry.isDirectory() ? "[D]" : entry.isSymbolicLink() ? "[L]" : "[F]"} ${entry.name}`);
        if (entry.isDirectory()) {
          await walk(path.join(current, entry.name), depth + 1, `${prefix}  `);
        }
      }
    }
    await walk(absolutePath, 1, "");
    await audit("get_project_tree", { project, relativePath, entries: lines.length });
    return textResult({ project, path: relativePath, tree: lines, truncated: lines.length >= maxEntries });
  },
);

server.registerTool(
  "list_directory",
  {
    title: "List one project directory",
    description: "Lists immediate files and folders with type, size, and modification time. Secret and dependency paths remain blocked.",
    inputSchema: {
      project: projectNameSchema,
      path: relativePathSchema,
      includeHidden: z.boolean().default(false),
      maxEntries: z.number().int().min(1).max(2000).default(500),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ project, path: relativePath, includeHidden, maxEntries }) => {
    const { root, absolutePath } = await resolveProjectPath(project, relativePath);
    await assertNoSymlinkEscape(root, absolutePath);
    const directoryStat = await stat(absolutePath);
    if (!directoryStat.isDirectory()) throw new Error("Requested path is not a directory.");

    const directoryEntries = await readdir(absolutePath, { withFileTypes: true });
    const entries: Array<Record<string, unknown>> = [];
    directoryEntries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

    for (const entry of directoryEntries) {
      if (entries.length >= maxEntries) break;
      if (!includeHidden && entry.name.startsWith(".")) continue;
      const itemRelative = normalizeSlashes(path.relative(root, path.join(absolutePath, entry.name)));
      if (isIgnoredRelativePath(itemRelative)) continue;
      const itemStat = entry.isSymbolicLink() ? null : await stat(path.join(absolutePath, entry.name));
      entries.push({
        name: entry.name,
        path: itemRelative,
        type: entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "file",
        size: itemStat?.isFile() ? itemStat.size : null,
        modifiedAt: itemStat?.mtime.toISOString() ?? null,
      });
    }

    await audit("list_directory", { project, relativePath, entries: entries.length });
    return textResult({ project, path: relativePath, entries, truncated: entries.length >= maxEntries });
  },
);

server.registerTool(
  "read_file",
  {
    title: "Read a project file",
    description: "Use this to read a text file with line numbers and a SHA-256 version hash. Secret-like and dependency files are blocked.",
    inputSchema: {
      project: projectNameSchema,
      path: z.string().min(1),
      startLine: z.number().int().min(1).default(1),
      endLine: z.number().int().min(1).max(100000).optional(),
      maxLines: z.number().int().min(1).max(2000).default(500),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ project, path: relativePath, startLine, endLine, maxLines }) => {
    const { root, absolutePath } = await resolveProjectPath(project, relativePath);
    await assertNoSymlinkEscape(root, absolutePath);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) throw new Error("Requested path is not a file.");
    if (fileStat.size > 5_000_000) throw new Error("File is larger than the 5 MB read limit.");

    const raw = await readFile(absolutePath, "utf8");
    const lines = raw.split(/\r?\n/);
    const finalEnd = Math.min(endLine ?? startLine + maxLines - 1, startLine + maxLines - 1, lines.length);
    const selected = lines.slice(startLine - 1, finalEnd).map((line, index) => `${startLine + index}: ${line}`);
    await audit("read_file", { project, relativePath, startLine, endLine: finalEnd });
    return textResult({
      project,
      path: relativePath,
      sha256: sha256(raw),
      totalLines: lines.length,
      startLine,
      endLine: finalEnd,
      content: selected.join("\n"),
    });
  },
);

server.registerTool(
  "search_files",
  {
    title: "Search project file names or glob patterns",
    description: "Finds files by name substring or safe glob without reading file contents.",
    inputSchema: {
      project: projectNameSchema,
      query: z.string().min(1).max(300),
      path: relativePathSchema,
      mode: z.enum(["name", "glob"]).default("name"),
      includeDirectories: z.boolean().default(false),
      maxResults: z.number().int().min(1).max(1000).default(200),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ project, query, path: relativePath, mode, includeDirectories, maxResults }) => {
    if (path.isAbsolute(query) || query.split(/[\\/]/).includes("..")) {
      throw new Error("Absolute paths and parent traversal are not allowed in search patterns.");
    }
    const { root, absolutePath } = await resolveProjectPath(project, relativePath);
    await assertNoSymlinkEscape(root, absolutePath);
    const pattern = mode === "glob" ? query : "**/*";
    const candidates = await fg(pattern, {
      cwd: absolutePath,
      onlyFiles: !includeDirectories,
      onlyDirectories: false,
      dot: false,
      followSymbolicLinks: false,
      ignore: defaultIgnoreGlobs,
      markDirectories: false,
    });
    const loweredQuery = query.toLowerCase();
    const filtered = candidates
      .filter((candidate) => mode === "glob" || path.basename(candidate).toLowerCase().includes(loweredQuery))
      .sort((a, b) => pathDepth(a) - pathDepth(b) || a.localeCompare(b))
      .slice(0, maxResults)
      .map((candidate) => normalizeSlashes(path.relative(root, path.join(absolutePath, candidate))));

    await audit("search_files", { project, query, mode, results: filtered.length });
    return textResult({ project, path: relativePath, query, mode, results: filtered, truncated: filtered.length >= maxResults });
  },
);

server.registerTool(
  "search_code",
  {
    title: "Search text or regex across project code",
    description: "High-speed code search using ripgrep when available, with a safe built-in fallback. Generated, dependency, and secret files are ignored.",
    inputSchema: {
      project: projectNameSchema,
      query: z.string().min(1).max(300),
      regex: z.boolean().default(false),
      caseSensitive: z.boolean().default(false),
      glob: z.string().default("**/*"),
      maxResults: z.number().int().min(1).max(300).default(100),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ project, query, regex, caseSensitive, glob, maxResults }) => {
    const config = await getProject(project);
    const root = path.resolve(config.root);
    const fast = await searchWithRipgrep({
      root,
      query,
      regex,
      caseSensitive,
      glob,
      ignoreGlobs: defaultIgnoreGlobs,
      maxResults,
    });

    const response = fast.available && !fast.error
      ? {
          project,
          query,
          engine: "ripgrep",
          durationMs: fast.durationMs,
          results: fast.results,
          truncated: fast.truncated,
        }
      : {
          project,
          query,
          engine: "node-fallback",
          ...(await searchCodeFallback(root, query, regex, caseSensitive, glob, maxResults)),
          ripgrepError: fast.error ?? "ripgrep is not installed",
        };

    await audit("search_code", {
      project,
      query,
      regex,
      engine: response.engine,
      results: response.results.length,
    });
    return textResult(response);
  },
);

server.registerTool(
  "write_file",
  {
    title: "Create or replace a project file",
    description: "Use only when a complete file replacement is appropriate. Existing files require expectedSha256 from read_file.",
    inputSchema: {
      project: projectNameSchema,
      path: z.string().min(1),
      content: z.string().max(2_000_000),
      expectedSha256: z.string().length(64).optional(),
      createParents: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ project, path: relativePath, content, expectedSha256, createParents }) => {
    const { root, absolutePath } = await resolveProjectPath(project, relativePath);
    await assertNoSymlinkEscape(root, absolutePath);

    let previous: string | null = null;
    try {
      previous = await readFile(absolutePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    if (previous !== null) {
      if (!expectedSha256) throw new Error("expectedSha256 is required when replacing an existing file.");
      if (sha256(previous) !== expectedSha256) throw new Error("File changed since it was read. Read it again before writing.");
      await backupFile(project, relativePath, absolutePath);
    } else if (createParents) {
      await mkdir(path.dirname(absolutePath), { recursive: true });
    }

    await writeFile(absolutePath, content, "utf8");
    await audit("write_file", { project, relativePath, existed: previous !== null, bytes: Buffer.byteLength(content) });
    return textResult({ project, path: relativePath, sha256: sha256(content), bytes: Buffer.byteLength(content) });
  },
);

server.registerTool(
  "create_file",
  {
    title: "Create a new project file",
    description: "Creates a new file and refuses to overwrite an existing path.",
    inputSchema: {
      project: projectNameSchema,
      path: z.string().min(1),
      content: z.string().max(2_000_000).default(""),
      createParents: z.boolean().default(true),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, path: relativePath, content, createParents }) => {
    const { root, absolutePath } = await resolveProjectPath(project, relativePath);
    await assertNoSymlinkEscape(root, absolutePath);
    if (await pathExists(absolutePath)) throw new Error("Destination already exists. Use read_file and write_file/apply_patch instead.");
    if (createParents) await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, { encoding: "utf8", flag: "wx" });
    await audit("create_file", { project, relativePath, bytes: Buffer.byteLength(content) });
    return textResult({ project, path: relativePath, sha256: sha256(content), created: true });
  },
);

server.registerTool(
  "apply_patch",
  {
    title: "Apply a unified diff patch to one project file",
    description: "Preferred write tool for focused code edits. Read the file first and pass expectedSha256.",
    inputSchema: {
      project: projectNameSchema,
      path: z.string().min(1),
      patch: z.string().min(1).max(1_000_000),
      expectedSha256: z.string().length(64),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, path: relativePath, patch: patchText, expectedSha256 }) => {
    const { root, absolutePath } = await resolveProjectPath(project, relativePath);
    await assertNoSymlinkEscape(root, absolutePath);
    const current = await readFile(absolutePath, "utf8");
    if (sha256(current) !== expectedSha256) throw new Error("File changed since it was read. Read it again before patching.");

    const updated = applyPatch(current, patchText);
    if (updated === false) throw new Error("Patch could not be applied cleanly.");
    if (updated === current) throw new Error("Patch produced no changes.");

    await backupFile(project, relativePath, absolutePath);
    await writeFile(absolutePath, updated, "utf8");
    await audit("apply_patch", { project, relativePath, oldHash: expectedSha256, newHash: sha256(updated) });
    return textResult({ project, path: relativePath, sha256: sha256(updated), changed: true });
  },
);

server.registerTool(
  "rename_file",
  {
    title: "Rename or move one project file",
    description: "Moves a file inside the same configured project. Source hash is required and destination overwrite is refused.",
    inputSchema: {
      project: projectNameSchema,
      source: z.string().min(1),
      destination: z.string().min(1),
      expectedSha256: z.string().length(64),
      createParents: z.boolean().default(true),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, source, destination, expectedSha256, createParents }) => {
    const sourceResolved = await resolveProjectPath(project, source);
    const destinationResolved = await resolveProjectPath(project, destination);
    await assertNoSymlinkEscape(sourceResolved.root, sourceResolved.absolutePath);
    await assertNoSymlinkEscape(destinationResolved.root, destinationResolved.absolutePath);
    const sourceStat = await stat(sourceResolved.absolutePath);
    if (!sourceStat.isFile()) throw new Error("Source is not a regular file.");
    if (await pathExists(destinationResolved.absolutePath)) throw new Error("Destination already exists.");
    const current = await readFile(sourceResolved.absolutePath, "utf8");
    if (sha256(current) !== expectedSha256) throw new Error("Source changed since it was read.");
    await backupFile(project, source, sourceResolved.absolutePath);
    if (createParents) await mkdir(path.dirname(destinationResolved.absolutePath), { recursive: true });
    await rename(sourceResolved.absolutePath, destinationResolved.absolutePath);
    await audit("rename_file", { project, source, destination });
    return textResult({ project, source, destination, renamed: true, sha256: expectedSha256 });
  },
);

server.registerTool(
  "delete_file",
  {
    title: "Delete one project file with backup",
    description: "Deletes one regular file after hash verification. A backup is retained under LocalDev MCP logs/backups.",
    inputSchema: {
      project: projectNameSchema,
      path: z.string().min(1),
      expectedSha256: z.string().length(64),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, path: relativePath, expectedSha256 }) => {
    const { root, absolutePath } = await resolveProjectPath(project, relativePath);
    await assertNoSymlinkEscape(root, absolutePath);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) throw new Error("Requested path is not a regular file.");
    const current = await readFile(absolutePath, "utf8");
    if (sha256(current) !== expectedSha256) throw new Error("File changed since it was read.");
    await backupFile(project, relativePath, absolutePath);
    await unlink(absolutePath);
    await audit("delete_file", { project, relativePath, sha256: expectedSha256 });
    return textResult({ project, path: relativePath, deleted: true });
  },
);

server.registerTool(
  "run_command",
  {
    title: "Run an allowlisted development command",
    description: "Runs guarded PHP/Laravel, Composer, npm, or allowlisted Git commands. Shell operators and arbitrary executables are blocked.",
    inputSchema: {
      project: projectNameSchema,
      executable: z.enum(["php", "composer", "npm", "git"]),
      args: commandArgsSchema,
      cwd: relativePathSchema,
      timeoutSeconds: z.number().int().min(1).max(MAX_COMMAND_TIMEOUT_SECONDS).default(120),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, executable, args, cwd, timeoutSeconds }) => {
    const result = await runAllowedCommand({ project, executable: executable as AllowedExecutable, args, cwd, timeoutSeconds });
    await audit("run_command", commandAuditData(result));
    return textResult(result);
  },
);

server.registerTool(
  "run_tests",
  {
    title: "Run the detected project test suite",
    description: "Auto-detects Laravel or npm tests, with optional working directory and test filter.",
    inputSchema: {
      project: projectNameSchema,
      cwd: optionalCwdSchema,
      target: z.enum(["auto", "php", "npm"]).default("auto"),
      filter: z.string().max(300).optional(),
      compact: z.boolean().default(true),
      timeoutSeconds: z.number().int().min(1).max(MAX_COMMAND_TIMEOUT_SECONDS).default(900),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, cwd, target, filter, compact, timeoutSeconds }) => {
    let selectedTarget = target;
    if (selectedTarget === "auto") {
      selectedTarget = (await findMarkerCwd(project, "artisan", cwd)) !== null ? "php" : "npm";
    }

    if (selectedTarget === "php") {
      const resolvedCwd = await requireMarkerCwd(project, "artisan", cwd, "Laravel artisan");
      const args = ["artisan", "test"];
      if (compact) args.push("--compact");
      if (filter) args.push(`--filter=${filter}`);
      const result = await runAllowedCommand({ project, executable: "php", args, cwd: resolvedCwd, timeoutSeconds });
      await audit("run_tests", { ...commandAuditData(result), target: "php" });
      return textResult({ target: "php", ...result });
    }

    const resolvedCwd = await requireMarkerCwd(project, "package.json", cwd, "package.json");
    const scripts = await readPackageScripts(project, resolvedCwd);
    if (!scripts.test) throw new Error(`No npm 'test' script exists in ${resolvedCwd}/package.json.`);
    const args = ["test"];
    if (filter) args.push("--", filter);
    const result = await runAllowedCommand({ project, executable: "npm", args, cwd: resolvedCwd, timeoutSeconds });
    await audit("run_tests", { ...commandAuditData(result), target: "npm" });
    return textResult({ target: "npm", ...result });
  },
);

server.registerTool(
  "run_artisan",
  {
    title: "Run an allowlisted or configured read-only Artisan command",
    description: "Runs a built-in allowlisted Artisan command or a project-specific command explicitly configured as read-only. Use laravel_run_artisan for reviewed write-capable custom commands.",
    inputSchema: {
      project: projectNameSchema,
      command: z.string().min(1).max(100),
      args: commandArgsSchema,
      cwd: optionalCwdSchema,
      timeoutSeconds: z.number().int().min(1).max(MAX_COMMAND_TIMEOUT_SECONDS).default(120),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, command, args, cwd, timeoutSeconds }) => {
    const resolvedCwd = await requireMarkerCwd(project, "artisan", cwd, "Laravel artisan");
    const projectConfig = await getProject(project);

    if (projectConfig.readOnlyArtisanCommands.includes(command)) {
      if (args.some((arg) => /^--(?:force|env)(?:=|$)/i.test(arg))) {
        throw new Error("Production, environment-selection, and force flags are blocked.");
      }
      const commandArgs = buildArtisanArguments(command, args, {});
      const result = await runLaravelProcess({ project, cwd: resolvedCwd, args: commandArgs, timeoutSeconds });
      await audit("run_artisan", {
        project,
        cwd: resolvedCwd,
        command,
        risk: "READ_ONLY",
        success: result.exitCode === 0 && !result.timedOut && !result.outputLimitExceeded,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      });
      assertSuccessfulProcess(command, result);
      return textResult({ risk: "READ_ONLY", ...result });
    }

    const result = await runAllowedCommand({ project, executable: "php", args: ["artisan", command, ...args], cwd: resolvedCwd, timeoutSeconds });
    await audit("run_artisan", commandAuditData(result));
    return textResult(result);
  },
);

server.registerTool(
  "laravel_run_artisan",
  {
    title: "Run a risk-classified Laravel Artisan command",
    description: "Runs built-in or project-specific Artisan commands through a risk classifier. Unknown custom commands require explicit write approval unless listed as read-only in the project configuration.",
    inputSchema: {
      project: projectNameSchema,
      cwd: optionalCwdSchema,
      command: z.string().min(1).max(100),
      arguments: z.array(z.string().max(1000)).max(40).default([]),
      options: z.record(z.string().max(82), artisanOptionValueSchema).default({}),
      confirmWrite: z.boolean().default(false),
      outputMode: z.enum(["full", "summary", "json"]).default("full"),
      timeoutSeconds: z.number().int().min(1).max(MAX_COMMAND_TIMEOUT_SECONDS).default(120),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, cwd, command, arguments: positional, options, confirmWrite, outputMode, timeoutSeconds }) => {
    const resolvedCwd = await requireMarkerCwd(project, "artisan", cwd, "Laravel artisan");
    const projectConfig = await getProject(project);
    const risk = assertArtisanExecutionAllowed({
      command,
      project: projectConfig,
      confirmWrite,
    });
    const args = buildArtisanArguments(command, positional, options);
    const result = await runLaravelProcess({ project, cwd: resolvedCwd, args, timeoutSeconds });
    await audit("laravel_run_artisan", {
      project,
      cwd: resolvedCwd,
      command,
      risk,
      success: result.exitCode === 0 && !result.timedOut && !result.outputLimitExceeded,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    });
    assertSuccessfulProcess(command, result);

    if (outputMode === "summary") {
      return textResult({ risk, ...summarizeProcessResult(command, result) });
    }
    if (outputMode === "json") {
      const parsed = parseJsonDocument(result.stdout);
      return textResult({ risk, parsed, exitCode: result.exitCode, durationMs: result.durationMs });
    }
    return textResult({ risk, ...result });
  },
);

server.registerTool(
  "laravel_tinker_execute",
  {
    title: "Execute guarded multiline Laravel Tinker code",
    description: "Runs reviewed PHP code through Laravel Tinker using an ephemeral script outside the repository. Process, filesystem, network, raw-SQL, and secret access are blocked; database writes require explicit approval.",
    inputSchema: {
      project: projectNameSchema,
      cwd: optionalCwdSchema,
      code: z.string().min(1).max(100_000),
      transactionMode: z.enum(["none", "rollback", "commit"]).default("none"),
      outputMode: z.enum(["full", "sanitized", "json"]).default("sanitized"),
      allowDatabaseWrite: z.boolean().default(false),
      timeoutSeconds: z.number().int().min(1).max(MAX_COMMAND_TIMEOUT_SECONDS).default(300),
      maxOutputChars: z.number().int().min(1000).max(1_000_000).default(120_000),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, cwd, code, transactionMode, outputMode, allowDatabaseWrite, timeoutSeconds, maxOutputChars }) => {
    const resolvedCwd = await requireMarkerCwd(project, "artisan", cwd, "Laravel artisan");
    const result = await executeLaravelTinker({
      project,
      cwd: resolvedCwd,
      code,
      transactionMode,
      outputMode,
      allowDatabaseWrite,
      timeoutSeconds,
      maxOutputChars,
    });
    await audit("laravel_tinker_execute", {
      project,
      cwd: resolvedCwd,
      codeSha256: result.codeSha256,
      transactionMode,
      databaseWriteRequested: allowDatabaseWrite,
      databaseWriteDetected: result.databaseWriteDetected,
      success: result.exitCode === 0 && !result.timedOut,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    });
    return textResult(result);
  },
);

server.registerTool(
  "local_secret_operation",
  {
    title: "Use an approved local environment secret in memory",
    description: "Checks an approved Laravel .env key or computes a digest/HMAC without returning, logging, placing on the command line, or writing the secret value.",
    inputSchema: {
      project: projectNameSchema,
      cwd: optionalCwdSchema,
      envKey: z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/),
      operation: z.enum(["hmac_sha256", "hmac_sha1", "sha256", "presence_check"]),
      payload: z.string().max(1_000_000).optional(),
      outputEncoding: z.enum(["hex", "hex_with_algorithm_prefix"]).default("hex"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ project, cwd, envKey, operation, payload, outputEncoding }) => {
    const resolvedCwd = await requireMarkerCwd(project, "artisan", cwd, "Laravel artisan");
    const result = await localSecretOperation({
      project,
      cwd: resolvedCwd,
      envKey,
      operation,
      payload,
      outputEncoding,
    });
    await audit("local_secret_operation", {
      project,
      cwd: resolvedCwd,
      envKey,
      operation,
      payloadSha256: payload === undefined ? null : sha256(payload),
      success: true,
    });
    return textResult(result);
  },
);

server.registerTool(
  "local_http_request",
  {
    title: "Send a loopback-only HTTP integration request",
    description: "Sends an HTTP request only to approved hosts that resolve exclusively to loopback addresses. Redirects are revalidated and sensitive headers are redacted.",
    inputSchema: {
      project: projectNameSchema,
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).default("GET"),
      url: z.string().url().max(2000),
      headers: z.record(z.string().max(200), z.string().max(20_000)).default({}),
      body: z.string().max(1_000_000).optional(),
      timeoutSeconds: z.number().int().min(1).max(300).default(30),
      followRedirects: z.boolean().default(false),
      expectedStatuses: z.array(z.number().int().min(100).max(599)).max(20).default([]),
      redactHeaders: z.array(z.string().min(1).max(200)).max(50).default([]),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, method, url, headers, body, timeoutSeconds, followRedirects, expectedStatuses, redactHeaders }) => {
    const result = await localHttpRequest({
      project,
      method,
      url,
      headers,
      body,
      timeoutSeconds,
      followRedirects,
      expectedStatuses,
      redactHeaders,
    });
    const auditUrl = new URL(url);
    await audit("local_http_request", {
      project,
      method,
      target: `${auditUrl.origin}${auditUrl.pathname}`,
      success: result.assertionPassed,
      status: result.status,
      durationMs: result.durationMs,
    });
    return textResult(result);
  },
);

server.registerTool(
  "start_local_process",
  {
    title: "Start a managed local Laravel process",
    description: "Starts only a LocalDev-managed Laravel development server on a loopback host. Port 0 selects an available ephemeral port automatically; occupied explicit ports are refused, and unrelated processes are never adopted or stopped.",
    inputSchema: {
      project: projectNameSchema,
      cwd: optionalCwdSchema,
      kind: z.literal("laravel_server").default("laravel_server"),
      host: z.enum(["127.0.0.1", "localhost", "::1"]).default("127.0.0.1"),
      port: z.number().int().min(0).max(65535).default(0),
      readinessTimeoutSeconds: z.number().int().min(1).max(60).default(15),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, cwd, host, port, readinessTimeoutSeconds }) => {
    const resolvedCwd = await requireMarkerCwd(project, "artisan", cwd, "Laravel artisan");
    const result = await startLaravelServer({ project, cwd: resolvedCwd, host, port, readinessTimeoutSeconds });
    await audit("start_local_process", {
      project,
      cwd: resolvedCwd,
      kind: "laravel_server",
      host,
      port,
      sessionId: result.sessionId,
      success: result.running,
    });
    return textResult(result);
  },
);

server.registerTool(
  "inspect_local_process",
  {
    title: "Inspect a LocalDev-managed process",
    description: "Returns status and sanitized output for a process previously started by this MCP server instance.",
    inputSchema: {
      project: projectNameSchema,
      sessionId: z.string().regex(/^local-[0-9a-f-]{36}$/),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ project, sessionId }) => {
    const result = inspectLocalProcess({ project, sessionId });
    await audit("inspect_local_process", { project, sessionId, running: result.running });
    return textResult(result);
  },
);

server.registerTool(
  "stop_local_process",
  {
    title: "Stop a LocalDev-managed process",
    description: "Stops only a process session created by start_local_process for the same project.",
    inputSchema: {
      project: projectNameSchema,
      sessionId: z.string().regex(/^local-[0-9a-f-]{36}$/),
      timeoutSeconds: z.number().int().min(1).max(60).default(10),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ project, sessionId, timeoutSeconds }) => {
    const result = await stopLocalProcess({ project, sessionId, timeoutSeconds });
    await audit("stop_local_process", { project, sessionId, success: result.running === false, exitCode: result.exitCode });
    return textResult(result);
  },
);

server.registerTool(
  "laravel_database_snapshot",
  {
    title: "Read a structured Laravel database snapshot",
    description: "Reads a count and bounded rows through Laravel's query builder. Table, columns, filters, ordering, and limit are structured; model-provided raw SQL is not accepted.",
    inputSchema: {
      project: projectNameSchema,
      cwd: optionalCwdSchema,
      query: databaseQuerySchema,
      timeoutSeconds: z.number().int().min(1).max(MAX_COMMAND_TIMEOUT_SECONDS).default(120),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ project, cwd, query, timeoutSeconds }) => {
    const resolvedCwd = await requireMarkerCwd(project, "artisan", cwd, "Laravel artisan");
    const result = await laravelDatabaseSnapshot({ project, cwd: resolvedCwd, query, timeoutSeconds });
    await audit("laravel_database_snapshot", {
      project,
      cwd: resolvedCwd,
      table: query.table,
      count: result.count,
      returnedRows: result.rows.length,
      success: true,
    });
    return textResult(result);
  },
);

server.registerTool(
  "laravel_database_assert",
  {
    title: "Run a structured Laravel database assertion",
    description: "Evaluates count, existence, column, or JSON-path assertions over a bounded read-only Laravel query without accepting raw SQL.",
    inputSchema: {
      project: projectNameSchema,
      cwd: optionalCwdSchema,
      query: databaseQuerySchema,
      assertion: z.enum(["count_equals", "exists", "not_exists", "column_equals", "json_path_equals"]),
      expected: z.unknown().optional(),
      column: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/).optional(),
      jsonPath: z.string().regex(/^[A-Za-z0-9_.-]{1,240}$/).optional(),
      timeoutSeconds: z.number().int().min(1).max(MAX_COMMAND_TIMEOUT_SECONDS).default(120),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ project, cwd, query, assertion, expected, column, jsonPath, timeoutSeconds }) => {
    const resolvedCwd = await requireMarkerCwd(project, "artisan", cwd, "Laravel artisan");
    const result = await laravelDatabaseAssert({
      project,
      cwd: resolvedCwd,
      query,
      assertion,
      expected,
      column,
      jsonPath,
      timeoutSeconds,
    });
    await audit("laravel_database_assert", {
      project,
      cwd: resolvedCwd,
      table: query.table,
      assertion,
      passed: result.passed,
    });
    return textResult(result);
  },
);

server.registerTool(
  "run_npm",
  {
    title: "Run an npm package script",
    description: "Runs one script declared in package.json from an auto-detected or specified npm app root.",
    inputSchema: {
      project: projectNameSchema,
      script: z.string().regex(/^[A-Za-z0-9:_-]+$/).max(100),
      args: commandArgsSchema,
      cwd: optionalCwdSchema,
      timeoutSeconds: z.number().int().min(1).max(MAX_COMMAND_TIMEOUT_SECONDS).default(300),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, script, args, cwd, timeoutSeconds }) => {
    const resolvedCwd = await requireMarkerCwd(project, "package.json", cwd, "package.json");
    const scripts = await readPackageScripts(project, resolvedCwd);
    if (!scripts[script]) throw new Error(`npm script '${script}' does not exist in ${resolvedCwd}/package.json.`);
    const commandArgs = ["run", script];
    if (args.length > 0) commandArgs.push("--", ...args);
    const result = await runAllowedCommand({ project, executable: "npm", args: commandArgs, cwd: resolvedCwd, timeoutSeconds });
    await audit("run_npm", commandAuditData(result));
    return textResult(result);
  },
);

server.registerTool(
  "run_validation_plan",
  {
    title: "Run a compact multi-step validation plan",
    description: "Runs Git diff checks plus selected Composer, Laravel test, and npm script validations in one local call, returning compact step summaries to reduce round-trips and context size.",
    inputSchema: {
      project: projectNameSchema,
      profile: z.enum(["quick", "backend", "frontend", "full"]).default("quick"),
      laravelCwd: optionalCwdSchema,
      npmCwd: optionalCwdSchema,
      phpFilter: z.string().max(300).optional(),
      npmScripts: z.array(z.string().regex(/^[A-Za-z0-9:_-]+$/).max(100)).max(10).default([]),
      stopOnFailure: z.boolean().default(true),
      timeoutSeconds: z.number().int().min(1).max(MAX_COMMAND_TIMEOUT_SECONDS).default(900),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, profile, laravelCwd, npmCwd, phpFilter, npmScripts, stopOnFailure, timeoutSeconds }) => {
    const steps: Array<Record<string, unknown>> = [];
    let failed = false;
    const record = (name: string, result: Awaited<ReturnType<typeof runAllowedCommand>> | Awaited<ReturnType<typeof runGit>>) => {
      const summary = summarizeProcessResult(name, result);
      steps.push(summary);
      if (result.exitCode !== 0 || result.timedOut) failed = true;
    };
    const shouldStop = () => failed && stopOnFailure;

    const { root } = await resolveProjectPath(project, ".");
    const diffCheck = await runGit(root, ["diff", "--check"], Math.min(timeoutSeconds, 300));
    record("git diff --check", diffCheck);

    const resolvedComposerCwd = await findMarkerCwd(project, "composer.json", laravelCwd);
    const resolvedLaravelCwd = await findMarkerCwd(project, "artisan", laravelCwd);
    const resolvedNpmCwd = await findMarkerCwd(project, "package.json", npmCwd);

    if (!shouldStop() && (profile === "quick" || profile === "backend" || profile === "full") && resolvedComposerCwd) {
      const result = await runAllowedCommand({
        project,
        executable: "composer",
        args: ["validate"],
        cwd: resolvedComposerCwd,
        timeoutSeconds,
      });
      record("composer validate", result);
    }

    if (!shouldStop() && (profile === "backend" || profile === "full" || phpFilter) && resolvedLaravelCwd) {
      const args = ["artisan", "test", "--compact"];
      if (phpFilter) args.push(`--filter=${phpFilter}`);
      const result = await runAllowedCommand({
        project,
        executable: "php",
        args,
        cwd: resolvedLaravelCwd,
        timeoutSeconds,
      });
      record(phpFilter ? `php artisan test --filter=${phpFilter}` : "php artisan test", result);
    }

    if (!shouldStop() && resolvedNpmCwd && (profile === "frontend" || profile === "full" || npmScripts.length > 0)) {
      const availableScripts = await readPackageScripts(project, resolvedNpmCwd);
      const selectedScripts = npmScripts.length > 0
        ? npmScripts
        : ["build", "check"].filter((script) => Boolean(availableScripts[script]));
      for (const script of selectedScripts) {
        if (!availableScripts[script]) {
          steps.push({ name: `npm run ${script}`, skipped: true, reason: "Script not found." });
          continue;
        }
        const result = await runAllowedCommand({
          project,
          executable: "npm",
          args: ["run", script],
          cwd: resolvedNpmCwd,
          timeoutSeconds,
        });
        record(`npm run ${script}`, result);
        if (shouldStop()) break;
      }
    }

    const status = await runGit(root, ["status", "--short", "--branch"]);
    record("git status", status);
    const passed = steps.every((step) => step.skipped === true || step.exitCode === 0);
    await audit("run_validation_plan", { project, profile, passed, steps: steps.length });
    return textResult({
      project,
      profile,
      passed,
      detected: {
        laravelCwd: resolvedLaravelCwd,
        composerCwd: resolvedComposerCwd,
        npmCwd: resolvedNpmCwd,
      },
      steps,
    });
  },
);

server.registerTool(
  "git_switch_branch",
  {
    title: "Safely create or switch Git branches",
    description: "Creates a new branch or switches to an existing branch after validating the branch name, optional expected HEAD, and clean working-tree requirement.",
    inputSchema: {
      project: projectNameSchema,
      branch: z.string().min(1).max(240),
      create: z.boolean().default(false),
      requireClean: z.boolean().default(true),
      expectedHead: z.string().regex(/^[0-9a-fA-F]{7,64}$/).optional(),
      dryRun: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, branch, create, requireClean, expectedHead, dryRun }) => {
    validateGitBranchName(branch);
    const { root } = await resolveProjectPath(project, ".");
    const [status, currentBranch, currentHead] = await Promise.all([
      runGit(root, ["status", "--porcelain=v1"]),
      runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
      runGit(root, ["rev-parse", "HEAD"]),
    ]);
    if (status.exitCode !== 0 || currentBranch.exitCode !== 0 || currentHead.exitCode !== 0) {
      throw new Error("Git branch preflight failed.");
    }

    const beforeHead = currentHead.stdout.trim();
    const beforeBranch = currentBranch.stdout.trim();
    const dirty = status.stdout.trim().length > 0;
    if (requireClean && dirty) {
      throw new Error("Working tree is not clean. Commit, stash, or explicitly set requireClean=false before switching branches.");
    }
    if (expectedHead && beforeHead.toLowerCase() !== expectedHead.toLowerCase()) {
      throw new Error(`HEAD mismatch. Expected ${expectedHead}, found ${beforeHead}.`);
    }

    const command = create ? ["switch", "-c", branch] : ["switch", branch];
    if (dryRun) {
      await audit("git_switch_branch", { project, branch, create, requireClean, dryRun: true, beforeBranch, beforeHead, dirty });
      return textResult({
        project,
        branch,
        create,
        requireClean,
        dryRun: true,
        command: ["git", ...command],
        before: { branch: beforeBranch, head: beforeHead, dirty },
      });
    }

    const result = await runGit(root, command);
    const [afterBranch, afterHead, afterStatus] = result.exitCode === 0
      ? await Promise.all([
          runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
          runGit(root, ["rev-parse", "HEAD"]),
          runGit(root, ["status", "--short", "--branch"]),
        ])
      : [null, null, null];
    await audit("git_switch_branch", {
      project,
      branch,
      create,
      requireClean,
      dryRun: false,
      beforeBranch,
      beforeHead,
      exitCode: result.exitCode,
    });
    return textResult({
      project,
      branch,
      create,
      requireClean,
      dryRun: false,
      command: ["git", ...command],
      before: { branch: beforeBranch, head: beforeHead, dirty },
      after: result.exitCode === 0 ? {
        branch: afterBranch?.stdout.trim() ?? null,
        head: afterHead?.stdout.trim() ?? null,
        status: afterStatus?.stdout.trim() ?? "",
      } : null,
      ...result,
    });
  },
);

server.registerTool(
  "git_status",
  {
    title: "Get Git working-tree status",
    description: "Use this after edits to see modified, added, deleted, and untracked files.",
    inputSchema: { project: projectNameSchema },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ project }) => {
    const { root } = await resolveProjectPath(project, ".");
    const result = await runGit(root, ["status", "--short", "--branch"]);
    await audit("git_status", { project, exitCode: result.exitCode });
    return textResult({ project, ...result });
  },
);

server.registerTool(
  "git_diff",
  {
    title: "Get Git diff",
    description: "Reviews current unstaged or staged code changes. Optionally limit the diff to one project-relative path.",
    inputSchema: {
      project: projectNameSchema,
      path: z.string().optional(),
      staged: z.boolean().default(false),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ project, path: relativePath, staged }) => {
    const { root } = await resolveProjectPath(project, ".");
    const args = ["diff"];
    if (staged) args.push("--cached");
    args.push("--no-ext-diff", "--unified=3");
    if (relativePath) {
      await resolveProjectPath(project, relativePath);
      args.push("--", relativePath);
    }
    const result = await runGit(root, args);
    await audit("git_diff", { project, relativePath, staged, exitCode: result.exitCode });
    return textResult({ project, staged, path: relativePath ?? null, ...result });
  },
);

server.registerTool(
  "inspect_changed_files",
  {
    title: "Inspect all current Git changes in one call",
    description: "Returns branch/status, changed file names, diff stats, diff checks, staged changes, last commit, and an optional compact diff without re-scanning the whole project.",
    inputSchema: {
      project: projectNameSchema,
      includeDiff: z.boolean().default(false),
      includeStaged: z.boolean().default(true),
      maxDiffChars: z.number().int().min(1000).max(60_000).default(20_000),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ project, includeDiff, includeStaged, maxDiffChars }) => {
    const { root } = await resolveProjectPath(project, ".");
    const commands = [
      runGit(root, ["status", "--short", "--branch"]),
      runGit(root, ["diff", "--stat"]),
      runGit(root, ["diff", "--check"]),
      runGit(root, ["diff", "--name-status"]),
      runGit(root, ["log", "-1", "--oneline", "--decorate"]),
      includeDiff ? runGit(root, ["diff", "--no-ext-diff", "--unified=3"]) : Promise.resolve(null),
      includeStaged ? runGit(root, ["diff", "--cached", "--stat"]) : Promise.resolve(null),
      includeStaged ? runGit(root, ["diff", "--cached", "--name-status"]) : Promise.resolve(null),
      includeStaged && includeDiff ? runGit(root, ["diff", "--cached", "--no-ext-diff", "--unified=3"]) : Promise.resolve(null),
    ] as const;
    const [status, diffStat, diffCheck, names, lastCommit, diff, stagedStat, stagedNames, stagedDiff] = await Promise.all(commands);
    const result = {
      project,
      status: status.stdout.trim(),
      diffStat: diffStat.stdout.trim(),
      diffCheck: diffCheck.stdout.trim(),
      diffCheckPassed: diffCheck.exitCode === 0,
      changedFiles: parseNameStatus(names.stdout),
      lastCommit: lastCommit.stdout.trim(),
      staged: includeStaged ? {
        diffStat: stagedStat?.stdout.trim() ?? "",
        changedFiles: parseNameStatus(stagedNames?.stdout ?? ""),
        diff: includeDiff ? (stagedDiff?.stdout ?? "").slice(0, maxDiffChars) : undefined,
        diffTruncated: includeDiff ? (stagedDiff?.stdout.length ?? 0) > maxDiffChars : undefined,
      } : undefined,
      diff: includeDiff ? (diff?.stdout ?? "").slice(0, maxDiffChars) : undefined,
      diffTruncated: includeDiff ? (diff?.stdout.length ?? 0) > maxDiffChars : undefined,
    };
    await audit("inspect_changed_files", {
      project,
      changed: result.changedFiles.length,
      staged: result.staged?.changedFiles.length ?? 0,
      includeDiff,
    });
    return textResult(result);
  },
);

server.registerTool(
  "read_laravel_logs",
  {
    title: "Read recent Laravel log lines",
    description: "Reads and redacts recent lines from the newest Laravel log or a selected log file.",
    inputSchema: {
      project: projectNameSchema,
      cwd: optionalCwdSchema,
      file: z.string().max(255).optional(),
      maxLines: z.number().int().min(1).max(2000).default(300),
      contains: z.string().max(300).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ project, cwd, file, maxLines, contains }) => {
    const laravelCwd = await requireMarkerCwd(project, "artisan", cwd, "Laravel artisan");
    if (file && path.basename(file) !== file) throw new Error("Log file must be a basename inside storage/logs.");
    const logsRelative = normalizeSlashes(path.join(laravelCwd, "storage", "logs"));
    const logsResolved = await resolveProjectPath(project, logsRelative);
    const logEntries = await readdir(logsResolved.absolutePath, { withFileTypes: true });
    const candidates: Array<{ name: string; mtime: number }> = [];
    for (const entry of logEntries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".log")) continue;
      const entryStat = await stat(path.join(logsResolved.absolutePath, entry.name));
      candidates.push({ name: entry.name, mtime: entryStat.mtimeMs });
    }
    candidates.sort((a, b) => b.mtime - a.mtime);
    const selectedName = file ?? candidates[0]?.name;
    if (!selectedName) throw new Error("No Laravel .log files were found.");
    if (!candidates.some((candidate) => candidate.name === selectedName)) throw new Error(`Log file '${selectedName}' was not found.`);

    const selectedPath = path.join(logsResolved.absolutePath, selectedName);
    const selectedStat = await stat(selectedPath);
    if (selectedStat.size > 20_000_000) throw new Error("Log file exceeds the 20 MB safety limit. Rotate or narrow it locally first.");
    const raw = await readFile(selectedPath, "utf8");
    const allLines = raw.split(/\r?\n/);
    const matching = contains
      ? allLines.map((line, index) => ({ line, index })).filter((item) => item.line.toLowerCase().includes(contains.toLowerCase()))
      : allLines.map((line, index) => ({ line, index }));
    const selected = matching.slice(-maxLines).map((item) => `${item.index + 1}: ${redactSecrets(item.line)}`);
    await audit("read_laravel_logs", { project, laravelCwd, file: selectedName, lines: selected.length, filtered: Boolean(contains) });
    return textResult({
      project,
      cwd: laravelCwd,
      file: selectedName,
      totalLines: allLines.length,
      returnedLines: selected.length,
      content: selected.join("\n"),
    });
  },
);

server.registerTool(
  "inspect_routes",
  {
    title: "Inspect Laravel routes",
    description: "Runs route:list with optional method, path, and name filters.",
    inputSchema: {
      project: projectNameSchema,
      cwd: optionalCwdSchema,
      method: z.string().max(30).optional(),
      path: z.string().max(200).optional(),
      name: z.string().max(200).optional(),
      json: z.boolean().default(false),
      timeoutSeconds: z.number().int().min(1).max(MAX_COMMAND_TIMEOUT_SECONDS).default(120),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ project, cwd, method, path: routePath, name, json, timeoutSeconds }) => {
    const resolvedCwd = await requireMarkerCwd(project, "artisan", cwd, "Laravel artisan");
    const args = ["artisan", "route:list"];
    if (method) args.push(`--method=${method}`);
    if (routePath) args.push(`--path=${routePath}`);
    if (name) args.push(`--name=${name}`);
    if (json) args.push("--json");
    const result = await runAllowedCommand({ project, executable: "php", args, cwd: resolvedCwd, timeoutSeconds });
    await audit("inspect_routes", commandAuditData(result));
    return textResult(result);
  },
);

server.registerTool(
  "inspect_database_schema",
  {
    title: "Inspect Laravel database schema",
    description: "Runs Laravel's read-only db:show or db:table command. It does not run migrations or write data.",
    inputSchema: {
      project: projectNameSchema,
      cwd: optionalCwdSchema,
      table: z.string().regex(/^[A-Za-z0-9_.-]+$/).max(128).optional(),
      counts: z.boolean().default(false),
      views: z.boolean().default(false),
      timeoutSeconds: z.number().int().min(1).max(MAX_COMMAND_TIMEOUT_SECONDS).default(120),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ project, cwd, table, counts, views, timeoutSeconds }) => {
    const resolvedCwd = await requireMarkerCwd(project, "artisan", cwd, "Laravel artisan");
    const args = table ? ["artisan", "db:table", table] : ["artisan", "db:show"];
    if (!table && counts) args.push("--counts");
    if (!table && views) args.push("--views");
    const result = await runAllowedCommand({ project, executable: "php", args, cwd: resolvedCwd, timeoutSeconds });
    await audit("inspect_database_schema", commandAuditData(result));
    return textResult(result);
  },
);

server.registerTool(
  "run_phpunit",
  {
    title: "Run PHPUnit directly",
    description: "Runs vendor/bin/phpunit with optional filter, test suite, and path from a Laravel/Composer app root.",
    inputSchema: {
      project: projectNameSchema,
      cwd: optionalCwdSchema,
      filter: z.string().max(300).optional(),
      testsuite: z.string().max(200).optional(),
      path: z.string().max(500).optional(),
      timeoutSeconds: z.number().int().min(1).max(MAX_COMMAND_TIMEOUT_SECONDS).default(900),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, cwd, filter, testsuite, path: testPath, timeoutSeconds }) => {
    const resolvedCwd = await requireMarkerCwd(project, "composer.json", cwd, "composer.json");
    const args = ["vendor/bin/phpunit"];
    if (filter) args.push(`--filter=${filter}`);
    if (testsuite) args.push(`--testsuite=${testsuite}`);
    if (testPath) {
      await resolveProjectPath(project, normalizeSlashes(path.join(resolvedCwd, testPath)));
      args.push(testPath);
    }
    const result = await runAllowedCommand({ project, executable: "php", args, cwd: resolvedCwd, timeoutSeconds });
    await audit("run_phpunit", commandAuditData(result));
    return textResult(result);
  },
);

server.registerTool(
  "run_pest",
  {
    title: "Run Pest directly",
    description: "Runs vendor/bin/pest with optional filter and path from a Laravel/Composer app root.",
    inputSchema: {
      project: projectNameSchema,
      cwd: optionalCwdSchema,
      filter: z.string().max(300).optional(),
      path: z.string().max(500).optional(),
      compact: z.boolean().default(true),
      timeoutSeconds: z.number().int().min(1).max(MAX_COMMAND_TIMEOUT_SECONDS).default(900),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, cwd, filter, path: testPath, compact, timeoutSeconds }) => {
    const resolvedCwd = await requireMarkerCwd(project, "composer.json", cwd, "composer.json");
    const args = ["vendor/bin/pest"];
    if (compact) args.push("--compact");
    if (filter) args.push(`--filter=${filter}`);
    if (testPath) {
      await resolveProjectPath(project, normalizeSlashes(path.join(resolvedCwd, testPath)));
      args.push(testPath);
    }
    const result = await runAllowedCommand({ project, executable: "php", args, cwd: resolvedCwd, timeoutSeconds });
    await audit("run_pest", commandAuditData(result));
    return textResult(result);
  },
);

server.registerTool(
  "run_eslint",
  {
    title: "Run the project's ESLint npm script",
    description: "Runs an existing lint script, normally npm run lint, with optional extra arguments.",
    inputSchema: {
      project: projectNameSchema,
      cwd: optionalCwdSchema,
      script: z.string().regex(/^[A-Za-z0-9:_-]+$/).max(100).default("lint"),
      args: commandArgsSchema,
      timeoutSeconds: z.number().int().min(1).max(MAX_COMMAND_TIMEOUT_SECONDS).default(300),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, cwd, script, args, timeoutSeconds }) => {
    const resolvedCwd = await requireMarkerCwd(project, "package.json", cwd, "package.json");
    const scripts = await readPackageScripts(project, resolvedCwd);
    if (!scripts[script]) throw new Error(`npm script '${script}' does not exist in ${resolvedCwd}/package.json.`);
    const commandArgs = ["run", script];
    if (args.length > 0) commandArgs.push("--", ...args);
    const result = await runAllowedCommand({ project, executable: "npm", args: commandArgs, cwd: resolvedCwd, timeoutSeconds });
    await audit("run_eslint", commandAuditData(result));
    return textResult(result);
  },
);

server.registerTool(
  "run_build",
  {
    title: "Run the project's npm build",
    description: "Runs an existing build script, normally npm run build.",
    inputSchema: {
      project: projectNameSchema,
      cwd: optionalCwdSchema,
      script: z.string().regex(/^[A-Za-z0-9:_-]+$/).max(100).default("build"),
      args: commandArgsSchema,
      timeoutSeconds: z.number().int().min(1).max(MAX_COMMAND_TIMEOUT_SECONDS).default(600),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, cwd, script, args, timeoutSeconds }) => {
    const resolvedCwd = await requireMarkerCwd(project, "package.json", cwd, "package.json");
    const scripts = await readPackageScripts(project, resolvedCwd);
    if (!scripts[script]) throw new Error(`npm script '${script}' does not exist in ${resolvedCwd}/package.json.`);
    const commandArgs = ["run", script];
    if (args.length > 0) commandArgs.push("--", ...args);
    const result = await runAllowedCommand({ project, executable: "npm", args: commandArgs, cwd: resolvedCwd, timeoutSeconds });
    await audit("run_build", commandAuditData(result));
    return textResult(result);
  },
);

server.registerTool(
  "composer_install",
  {
    title: "Install Composer dependencies",
    description: "Runs composer install with safe non-interactive defaults inside an auto-detected Composer project.",
    inputSchema: {
      project: projectNameSchema,
      cwd: optionalCwdSchema,
      noDev: z.boolean().default(false),
      optimizeAutoloader: z.boolean().default(false),
      timeoutSeconds: z.number().int().min(1).max(MAX_COMMAND_TIMEOUT_SECONDS).default(900),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, cwd, noDev, optimizeAutoloader, timeoutSeconds }) => {
    const resolvedCwd = await requireMarkerCwd(project, "composer.json", cwd, "composer.json");
    const args = ["install", "--no-interaction", "--prefer-dist"];
    if (noDev) args.push("--no-dev");
    if (optimizeAutoloader) args.push("--optimize-autoloader");
    const result = await runAllowedCommand({ project, executable: "composer", args, cwd: resolvedCwd, timeoutSeconds });
    await audit("composer_install", commandAuditData(result));
    return textResult(result);
  },
);

server.registerTool(
  "npm_install",
  {
    title: "Install npm dependencies",
    description: "Runs npm ci or npm install with no-audit/no-fund defaults inside an auto-detected npm project.",
    inputSchema: {
      project: projectNameSchema,
      cwd: optionalCwdSchema,
      mode: z.enum(["ci", "install"]).default("ci"),
      ignoreScripts: z.boolean().default(false),
      timeoutSeconds: z.number().int().min(1).max(MAX_COMMAND_TIMEOUT_SECONDS).default(900),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, cwd, mode, ignoreScripts, timeoutSeconds }) => {
    const resolvedCwd = await requireMarkerCwd(project, "package.json", cwd, "package.json");
    const args = [mode, "--no-audit", "--no-fund"];
    if (ignoreScripts) args.push("--ignore-scripts");
    const result = await runAllowedCommand({ project, executable: "npm", args, cwd: resolvedCwd, timeoutSeconds });
    await audit("npm_install", commandAuditData(result));
    return textResult(result);
  },
);

server.registerTool(
  "clear_laravel_cache",
  {
    title: "Clear Laravel caches",
    description: "Runs php artisan optimize:clear in an auto-detected Laravel application.",
    inputSchema: {
      project: projectNameSchema,
      cwd: optionalCwdSchema,
      timeoutSeconds: z.number().int().min(1).max(MAX_COMMAND_TIMEOUT_SECONDS).default(120),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ project, cwd, timeoutSeconds }) => {
    const resolvedCwd = await requireMarkerCwd(project, "artisan", cwd, "Laravel artisan");
    const result = await runAllowedCommand({ project, executable: "php", args: ["artisan", "optimize:clear"], cwd: resolvedCwd, timeoutSeconds });
    await audit("clear_laravel_cache", commandAuditData(result));
    return textResult(result);
  },
);

server.registerTool(
  "restart_queue_workers",
  {
    title: "Restart Laravel queue workers",
    description: "Runs php artisan queue:restart so local workers restart gracefully after their current job.",
    inputSchema: {
      project: projectNameSchema,
      cwd: optionalCwdSchema,
      timeoutSeconds: z.number().int().min(1).max(MAX_COMMAND_TIMEOUT_SECONDS).default(120),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ project, cwd, timeoutSeconds }) => {
    const resolvedCwd = await requireMarkerCwd(project, "artisan", cwd, "Laravel artisan");
    const result = await runAllowedCommand({ project, executable: "php", args: ["artisan", "queue:restart"], cwd: resolvedCwd, timeoutSeconds });
    await audit("restart_queue_workers", commandAuditData(result));
    return textResult(result);
  },
);

async function backupFile(project: string, relativePath: string, absolutePath: string): Promise<string> {
  const safeName = `${Date.now()}-${path.basename(relativePath)}`;
  const backupPath = path.join(appRoot, "logs", "backups", project, safeName);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await copyFile(absolutePath, backupPath);
  return backupPath;
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function findMarkerCwd(project: string, marker: string, requestedCwd?: string): Promise<string | null> {
  if (requestedCwd) {
    const resolved = await resolveProjectPath(project, requestedCwd);
    await assertNoSymlinkEscape(resolved.root, resolved.absolutePath);
    const markerPath = path.join(resolved.absolutePath, marker);
    return (await pathExists(markerPath)) ? resolved.relativePath : null;
  }

  const config = await getProject(project);
  const root = path.resolve(config.root);
  if (await pathExists(path.join(root, marker))) return ".";

  const matches = await fg(`**/${marker}`, {
    cwd: root,
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false,
    ignore: defaultIgnoreGlobs,
    deep: 5,
  });
  matches.sort((a, b) => pathDepth(a) - pathDepth(b) || a.localeCompare(b));
  const match = matches[0];
  return match ? normalizeSlashes(path.dirname(match)) : null;
}

async function requireMarkerCwd(
  project: string,
  marker: string,
  requestedCwd: string | undefined,
  label: string,
): Promise<string> {
  const cwd = await findMarkerCwd(project, marker, requestedCwd);
  if (cwd === null) {
    const suffix = requestedCwd ? ` in '${requestedCwd}'` : "";
    throw new Error(`${label} was not found${suffix}. Pass the correct project-relative cwd.`);
  }
  return cwd;
}

async function readPackageScripts(project: string, cwd: string): Promise<Record<string, string>> {
  const packagePath = normalizeSlashes(path.join(cwd, "package.json"));
  const { absolutePath } = await resolveProjectPath(project, packagePath);
  const parsed = JSON.parse(await readFile(absolutePath, "utf8")) as Record<string, unknown>;
  if (!isRecord(parsed.scripts)) return {};
  return Object.fromEntries(
    Object.entries(parsed.scripts).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function commandAuditData(result: {
  project: string;
  command: string[];
  cwd: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}): Record<string, unknown> {
  return {
    project: result.project,
    command: result.command,
    cwd: result.cwd,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
  };
}

function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

function pathDepth(value: string): number {
  return normalizeSlashes(value).split("/").filter(Boolean).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIgnoredRelativePath(relative: string): boolean {
  const normalized = normalizeSlashes(relative).toLowerCase();
  return defaultIgnoreGlobs.some((glob) => {
    const token = glob
      .replaceAll("**/", "")
      .replaceAll("/**", "")
      .replaceAll("*", "")
      .replaceAll("\\", "/")
      .toLowerCase();
    return Boolean(token) && normalized.includes(token);
  });
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  }));
  return results;
}

function countOccurrences(source: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const found = source.indexOf(needle, offset);
    if (found === -1) return count;
    count += 1;
    offset = found + needle.length;
  }
}

async function searchCodeFallback(
  root: string,
  query: string,
  regex: boolean,
  caseSensitive: boolean,
  glob: string,
  maxResults: number,
): Promise<{ results: Array<{ path: string; line: number; text: string }>; truncated: boolean }> {
  const files = await fg(glob, {
    cwd: root,
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false,
    ignore: defaultIgnoreGlobs,
    absolute: true,
  });
  const flags = caseSensitive ? "g" : "gi";
  const expression = regex
    ? new RegExp(query, flags)
    : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  const results: Array<{ path: string; line: number; text: string }> = [];

  for (const file of files) {
    if (results.length >= maxResults) break;
    const fileStat = await stat(file);
    if (fileStat.size > 1_500_000) continue;
    const stream = createReadStream(file, { encoding: "utf8" });
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let lineNumber = 0;
    for await (const line of reader) {
      lineNumber += 1;
      expression.lastIndex = 0;
      if (!expression.test(line)) continue;
      results.push({
        path: normalizeSlashes(path.relative(root, file)),
        line: lineNumber,
        text: line.trim().slice(0, 500),
      });
      if (results.length >= maxResults) break;
    }
  }
  return { results, truncated: results.length >= maxResults };
}

function parseNameStatus(output: string): Array<{ status: string; path: string; destination?: string }> {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      return {
        status: parts[0] ?? "",
        path: normalizeSlashes(parts[1] ?? ""),
        destination: parts[2] ? normalizeSlashes(parts[2]) : undefined,
      };
    });
}

function assertSuccessfulProcess(
  name: string,
  result: {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    outputLimitExceeded?: boolean;
  },
): void {
  if (result.timedOut) throw new Error(`${name} timed out.`);
  if (result.outputLimitExceeded) throw new Error(`${name} exceeded the configured output limit.`);
  if (result.exitCode === 0) return;

  const detail = compactOutput(redactSecrets(result.stderr || result.stdout), 4000, 30);
  throw new Error(`${name} failed with exit code ${result.exitCode ?? "unknown"}${detail ? `: ${detail}` : "."}`);
}

function summarizeProcessResult(
  name: string,
  result: {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    outputLimitExceeded?: boolean;
    durationMs: number;
  },
): Record<string, unknown> {
  const stdout = redactSecrets(result.stdout).trim();
  const stderr = redactSecrets(result.stderr).trim();
  return {
    name,
    exitCode: result.exitCode,
    passed: result.exitCode === 0 && !result.timedOut && !result.outputLimitExceeded,
    timedOut: result.timedOut,
    outputLimitExceeded: result.outputLimitExceeded ?? false,
    durationMs: result.durationMs,
    stdout: compactOutput(stdout),
    stderr: compactOutput(stderr),
  };
}

function compactOutput(output: string, maxChars = 4000, maxLines = 30): string {
  if (!output) return "";
  const lines = output.split(/\r?\n/);
  const selected = lines.length > maxLines ? lines.slice(-maxLines) : lines;
  const compact = selected.join("\n");
  return compact.length > maxChars ? compact.slice(-maxChars) : compact;
}

const transport = new StdioServerTransport();
await server.connect(transport);

console.error(`LocalDev MCP ${VERSION} started. Config: ${projectsFile}`);
