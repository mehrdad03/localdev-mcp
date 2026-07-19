import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

type FileInputMap = Readonly<Record<string, readonly string[]>>;

type LowLevelServer = {
  setRequestHandler: (schema: unknown, handler: (...args: unknown[]) => unknown) => unknown;
};

/**
 * The v1 MCP TypeScript SDK accepts only Zod input schemas and converts them to
 * standard JSON Schema. ChatGPT's connector runtime additionally understands a
 * top-level property advertised with `type: "file"` and mounts that file before
 * invoking the tool. This narrow wrapper patches only the tools/list response;
 * runtime argument validation still uses the original Zod string schema.
 */
export function installFileInputSchemaAdvertising(
  server: McpServer,
  fileInputs: FileInputMap,
): void {
  const lowLevel = server.server as unknown as LowLevelServer;
  const originalSetRequestHandler = lowLevel.setRequestHandler.bind(lowLevel);

  lowLevel.setRequestHandler = (schema, handler) => {
    if (schema !== ListToolsRequestSchema) {
      return originalSetRequestHandler(schema, handler);
    }

    return originalSetRequestHandler(schema, async (...args: unknown[]) => {
      const result = await handler(...args);
      return patchAdvertisedFileInputs(result, fileInputs);
    });
  };
}

export function patchAdvertisedFileInputs(
  result: unknown,
  fileInputs: FileInputMap,
): unknown {
  if (!isRecord(result) || !Array.isArray(result.tools)) return result;

  return {
    ...result,
    tools: result.tools.map((tool) => {
      if (!isRecord(tool) || typeof tool.name !== "string") return tool;
      const parameters = fileInputs[tool.name];
      if (!parameters || parameters.length === 0 || !isRecord(tool.inputSchema)) return tool;
      const properties = isRecord(tool.inputSchema.properties)
        ? tool.inputSchema.properties
        : {};

      const patchedProperties: Record<string, unknown> = { ...properties };
      for (const parameter of parameters) {
        const current = isRecord(properties[parameter]) ? properties[parameter] : {};
        patchedProperties[parameter] = {
          ...current,
          type: "file",
        };
      }

      return {
        ...tool,
        inputSchema: {
          ...tool.inputSchema,
          properties: patchedProperties,
        },
      };
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
