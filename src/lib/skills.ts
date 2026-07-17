import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { appRoot } from "../config.js";
import { sha256 } from "./text.js";

const skillsRoot = path.join(appRoot, "skills");
const skillNamePattern = /^[a-z0-9][a-z0-9-]{0,79}$/;
const supportingFilePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const readableExtensions = new Set([".md", ".txt", ".json", ".yaml", ".yml"]);

export type SkillSummary = {
  name: string;
  description: string;
  path: string;
  references: string[];
  templates: string[];
};

export type LoadedSkill = SkillSummary & {
  content: string;
  sha256: string;
};

export type LoadedSkillReference = {
  skill: string;
  reference: string;
  path: string;
  content: string;
  sha256: string;
};

export async function listInstalledSkills(): Promise<SkillSummary[]> {
  if (!(await isDirectory(skillsRoot))) return [];

  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && skillNamePattern.test(entry.name))
      .map(async (entry) => {
        try {
          return await readSkillSummary(entry.name);
        } catch {
          return null;
        }
      }),
  );

  return skills
    .filter((skill): skill is SkillSummary => skill !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadSkill(name: string): Promise<LoadedSkill> {
  assertSkillName(name);
  const summary = await readSkillSummary(name);
  const absolutePath = path.join(skillsRoot, name, "SKILL.md");
  const content = await readSafeSkillFile(absolutePath);

  return {
    ...summary,
    content,
    sha256: sha256(content),
  };
}

export async function loadSkillReference(
  skill: string,
  reference: string,
): Promise<LoadedSkillReference> {
  assertSkillName(skill);
  const normalizedReference = normalizeSupportingPath(reference);
  const skillRoot = path.join(skillsRoot, skill);
  const candidatePaths = normalizedReference.includes("/")
    ? [normalizedReference]
    : [path.join("references", normalizedReference), path.join("templates", normalizedReference)];

  for (const relativePath of candidatePaths) {
    const absolutePath = path.join(skillRoot, relativePath);
    if (!(await isFile(absolutePath))) continue;

    const content = await readSafeSkillFile(absolutePath, skillRoot);
    return {
      skill,
      reference: normalizeSlashes(relativePath),
      path: normalizeSlashes(path.join("skills", skill, relativePath)),
      content,
      sha256: sha256(content),
    };
  }

  throw new Error(
    `Unknown supporting file '${reference}' for skill '${skill}'. Call get_skill first to inspect available references and templates.`,
  );
}

async function readSkillSummary(name: string): Promise<SkillSummary> {
  assertSkillName(name);
  const skillRoot = path.join(skillsRoot, name);
  const skillFile = path.join(skillRoot, "SKILL.md");
  const content = await readSafeSkillFile(skillFile, skillRoot);
  const metadata = parseFrontmatter(content);

  return {
    name,
    description: metadata.description || `Installed LocalDev MCP skill: ${name}`,
    path: normalizeSlashes(path.join("skills", name, "SKILL.md")),
    references: await listSupportingFiles(skillRoot, "references"),
    templates: await listSupportingFiles(skillRoot, "templates"),
  };
}

async function listSupportingFiles(skillRoot: string, directory: string): Promise<string[]> {
  const root = path.join(skillRoot, directory);
  if (!(await isDirectory(root))) return [];

  const files = await walkFiles(root);
  return files
    .filter((relativePath) => readableExtensions.has(path.extname(relativePath).toLowerCase()))
    .map((relativePath) => normalizeSlashes(path.join(directory, relativePath)))
    .sort((a, b) => a.localeCompare(b));
}

async function walkFiles(root: string, relativePath = "."): Promise<string[]> {
  const absolutePath = path.join(root, relativePath);
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const childRelativePath = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(root, childRelativePath));
    } else if (entry.isFile()) {
      files.push(childRelativePath.replace(/^\.([/\\])/, ""));
    }
  }

  return files;
}

function parseFrontmatter(content: string): { name?: string; description?: string } {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return {};
  const normalized = content.replaceAll("\r\n", "\n");
  const closingIndex = normalized.indexOf("\n---\n", 4);
  if (closingIndex < 0) return {};

  const frontmatter = normalized.slice(4, closingIndex);
  const metadata: { name?: string; description?: string } = {};
  for (const line of frontmatter.split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key === "name") metadata.name = value;
    if (key === "description") metadata.description = value;
  }
  return metadata;
}

function assertSkillName(name: string): void {
  if (!skillNamePattern.test(name)) {
    throw new Error("Skill name must use lowercase letters, numbers, and hyphens only.");
  }
}

function normalizeSupportingPath(reference: string): string {
  const normalized = normalizeSlashes(reference).replace(/^\.\//, "");
  if (
    !supportingFilePattern.test(normalized) ||
    normalized.startsWith("/") ||
    normalized.endsWith("/") ||
    normalized.includes("..") ||
    normalized.includes("//")
  ) {
    throw new Error("Supporting file path is invalid or unsafe.");
  }

  const extension = path.extname(normalized).toLowerCase();
  if (!readableExtensions.has(extension)) {
    throw new Error("Only Markdown, text, JSON, and YAML supporting files are readable.");
  }

  if (
    normalized.includes("/") &&
    !normalized.startsWith("references/") &&
    !normalized.startsWith("templates/")
  ) {
    throw new Error("Supporting files must be inside references/ or templates/.");
  }

  return normalized;
}

async function readSafeSkillFile(absolutePath: string, expectedRoot = skillsRoot): Promise<string> {
  const fileStat = await lstat(absolutePath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error("Skill path is not a regular file.");
  }

  const [resolvedRoot, resolvedFile] = await Promise.all([
    realpath(expectedRoot),
    realpath(absolutePath),
  ]);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Skill file escaped the installed skills directory.");
  }

  return readFile(resolvedFile, "utf8");
}

async function isDirectory(absolutePath: string): Promise<boolean> {
  try {
    return (await stat(absolutePath)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(absolutePath: string): Promise<boolean> {
  try {
    return (await stat(absolutePath)).isFile();
  } catch {
    return false;
  }
}

function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}
