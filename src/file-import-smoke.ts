import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { detectMimeType } from "./lib/file-import.js";

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "localdev-mcp-file-import-smoke-"));
const projectRoot = path.join(temporaryRoot, "project");
const uploadRoot = path.join(temporaryRoot, "uploads");
const outsideRoot = path.join(temporaryRoot, "outside");
const projectsFile = path.join(temporaryRoot, "projects.json");

const pngBytes = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0x00, 0x01, 0x02, 0xff, 0x10, 0x00]),
]);
const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const webpBytes = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x08, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 ", "ascii"),
]);
const pdfBytes = Buffer.from("%PDF-1.7\n%binary\u0000\u00ff\n", "binary");
const svgBytes = Buffer.from("<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"></svg>", "utf8");

try {
  await Promise.all([
    mkdir(projectRoot, { recursive: true }),
    mkdir(uploadRoot, { recursive: true }),
    mkdir(outsideRoot, { recursive: true }),
  ]);
  await writeFile(projectsFile, JSON.stringify({
    projects: {
      sandbox: {
        root: projectRoot,
        stack: ["test"],
      },
    },
  }, null, 2), "utf8");

  const sourcePng = path.join(uploadRoot, "asset.png");
  const sourceJpeg = path.join(uploadRoot, "asset.jpg");
  const sourceWebp = path.join(uploadRoot, "asset.webp");
  const sourcePdf = path.join(uploadRoot, "asset.pdf");
  const sourceSvg = path.join(uploadRoot, "asset.svg");
  const outsideSource = path.join(outsideRoot, "outside.png");
  const secretSource = path.join(uploadRoot, ".env");
  await Promise.all([
    writeFile(sourcePng, pngBytes),
    writeFile(sourceJpeg, jpegBytes),
    writeFile(sourceWebp, webpBytes),
    writeFile(sourcePdf, pdfBytes),
    writeFile(sourceSvg, svgBytes),
    writeFile(outsideSource, pngBytes),
    writeFile(secretSource, "APP_KEY=do-not-import", "utf8"),
  ]);

  const mimeChecks = await Promise.all([
    detectMimeType(sourcePng),
    detectMimeType(sourceJpeg),
    detectMimeType(sourceWebp),
    detectMimeType(sourceSvg),
    detectMimeType(sourcePdf),
  ]);
  const expectedMimeChecks = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/svg+xml",
    "application/pdf",
  ];
  if (JSON.stringify(mimeChecks) !== JSON.stringify(expectedMimeChecks)) {
    throw new Error(`MIME detection mismatch: ${JSON.stringify(mimeChecks)}`);
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: {
      ...process.env,
      LOCALDEV_MCP_PROJECTS: projectsFile,
      LOCALDEV_MCP_IMPORT_ROOTS: uploadRoot,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "localdev-file-import-smoke", version: "0.6.0" });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const tool = listed.tools.find((candidate) => candidate.name === "import_file_to_project");
    if (!tool) throw new Error("import_file_to_project was not registered.");
    const sourceSchema = isRecord(tool.inputSchema.properties)
      ? tool.inputSchema.properties.source_file
      : undefined;
    if (!isRecord(sourceSchema) || sourceSchema.type !== "file") {
      throw new Error(`source_file was not advertised with type=file: ${JSON.stringify(sourceSchema)}`);
    }

    const imported = await call(client, "import_file_to_project", {
      project: "sandbox",
      source_file: sourcePng,
      destination: "public/assets/imported.png",
    });
    const expectedPngHash = hash(pngBytes);
    if (
      imported.path !== "public/assets/imported.png"
      || imported.size !== pngBytes.length
      || imported.mimeType !== "image/png"
      || imported.sha256 !== expectedPngHash
    ) {
      throw new Error(`Unexpected import result: ${JSON.stringify(imported)}`);
    }
    const importedBytes = await readFile(path.join(projectRoot, "public", "assets", "imported.png"));
    if (!importedBytes.equals(pngBytes)) throw new Error("Binary PNG bytes changed during import.");

    await expectToolError(client, "import_file_to_project", {
      project: "sandbox",
      source_file: sourcePng,
      destination: "public/assets/imported.png",
      overwrite: false,
    }, "overwrite=false");

    const overwritten = await call(client, "import_file_to_project", {
      project: "sandbox",
      source_file: sourcePdf,
      destination: "public/assets/imported.png",
      overwrite: true,
      expectedSha256: expectedPngHash,
    });
    if (overwritten.mimeType !== "application/pdf" || overwritten.sha256 !== hash(pdfBytes)) {
      throw new Error(`Overwrite result was incorrect: ${JSON.stringify(overwritten)}`);
    }
    const overwrittenBytes = await readFile(path.join(projectRoot, "public", "assets", "imported.png"));
    if (!overwrittenBytes.equals(pdfBytes)) throw new Error("Binary PDF bytes changed during overwrite.");

    await expectToolError(client, "import_file_to_project", {
      project: "sandbox",
      source_file: sourcePng,
      destination: "public/assets/imported.png",
      overwrite: true,
      expectedSha256: "0".repeat(64),
    }, "expectedSha256");

    await expectToolError(client, "import_file_to_project", {
      project: "sandbox",
      source_file: sourcePng,
      destination: "../escaped.png",
    }, "traversal");

    await expectToolError(client, "import_file_to_project", {
      project: "sandbox",
      source_file: outsideSource,
      destination: "public/assets/outside.png",
    }, "approved import roots");

    await expectToolError(client, "import_file_to_project", {
      project: "sandbox",
      source_file: secretSource,
      destination: "public/assets/secret.txt",
    }, "Secret-like source");

    await expectToolError(client, "import_file_to_project", {
      project: "sandbox",
      source_file: sourceWebp,
      destination: "missing/parents/asset.webp",
      createParents: false,
    }, "createParents=false");

    await expectToolError(client, "import_file_to_project", {
      project: "sandbox",
      source_file: sourceSvg,
      destination: "public/assets/new.svg",
      expectedSha256: hash(svgBytes),
    }, "existing destination");
  } finally {
    await client.close();
  }

  console.log(JSON.stringify({
    ok: true,
    checks: [
      "schema_type_file",
      "png_binary_import",
      "jpg_mime_detection",
      "webp_mime_detection",
      "svg_mime_detection",
      "pdf_mime_detection",
      "overwrite_false_blocked",
      "verified_binary_overwrite",
      "expected_sha_mismatch_blocked",
      "destination_traversal_blocked",
      "source_root_allowlist_enforced",
      "secret_like_source_blocked",
      "create_parents_false_enforced",
      "expected_sha_requires_existing_destination",
    ],
  }, null, 2));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name} failed: ${extractText(result.content)}`);
  return JSON.parse(extractText(result.content)) as Record<string, unknown>;
}

async function expectToolError(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  expectedText: string,
): Promise<void> {
  const result = await client.callTool({ name, arguments: args });
  const message = extractText(result.content);
  if (!result.isError || !message.toLowerCase().includes(expectedText.toLowerCase())) {
    throw new Error(`Expected ${name} to fail with '${expectedText}', received: ${message}`);
  }
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) throw new Error("Tool result did not contain an array.");
  const item = content.find((entry) => isRecord(entry) && entry.type === "text" && typeof entry.text === "string");
  if (!item || typeof item.text !== "string") throw new Error("Tool result did not contain text content.");
  return item.text;
}

function hash(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
