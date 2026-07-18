import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const envKeySchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/);
const artisanCommandSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,99}$/);

const projectSchema = z.object({
  root: z.string().min(1),
  stack: z.array(z.string()).default([]),
  phpExecutable: z.string().min(1).optional(),
  allowedSecretEnvKeys: z.array(envKeySchema).default([]),
  readOnlyArtisanCommands: z.array(artisanCommandSchema).default([]),
});

const configSchema = z.object({
  projects: z.record(z.string(), projectSchema),
});

export type ProjectConfig = z.infer<typeof projectSchema>;
export type ProjectsConfig = z.infer<typeof configSchema>;

const distDir = path.dirname(fileURLToPath(import.meta.url));
export const appRoot = path.resolve(distDir, "..");
const defaultProjectsFile = path.join(appRoot, "projects.json");
const localProjectsFile = path.join(appRoot, "projects.local.json");
export const projectsFile = process.env.LOCALDEV_MCP_PROJECTS
  ? path.resolve(process.env.LOCALDEV_MCP_PROJECTS)
  : (existsSync(localProjectsFile) ? localProjectsFile : defaultProjectsFile);

export async function loadConfig(): Promise<ProjectsConfig> {
  const raw = await readFile(projectsFile, "utf8");
  return configSchema.parse(JSON.parse(raw));
}

export async function getProject(name: string): Promise<ProjectConfig> {
  const config = await loadConfig();
  const project = config.projects[name];
  if (!project) {
    throw new Error(`Unknown project '${name}'. Call list_projects first.`);
  }
  return project;
}
