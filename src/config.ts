import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const projectSchema = z.object({
  root: z.string().min(1),
  stack: z.array(z.string()).default([]),
});

const configSchema = z.object({
  projects: z.record(z.string(), projectSchema),
});

export type ProjectConfig = z.infer<typeof projectSchema>;
export type ProjectsConfig = z.infer<typeof configSchema>;

const distDir = path.dirname(fileURLToPath(import.meta.url));
export const appRoot = path.resolve(distDir, "..");
export const projectsFile = process.env.LOCALDEV_MCP_PROJECTS
  ? path.resolve(process.env.LOCALDEV_MCP_PROJECTS)
  : path.join(appRoot, "projects.json");

let cached: ProjectsConfig | null = null;

export async function loadConfig(): Promise<ProjectsConfig> {
  if (cached) return cached;
  const raw = await readFile(projectsFile, "utf8");
  cached = configSchema.parse(JSON.parse(raw));
  return cached;
}

export async function getProject(name: string): Promise<ProjectConfig> {
  const config = await loadConfig();
  const project = config.projects[name];
  if (!project) {
    throw new Error(`Unknown project '${name}'. Call list_projects first.`);
  }
  return project;
}
