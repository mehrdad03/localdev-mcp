import { createHmac } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { parseJsonDocument } from "./lib/json.js";

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "localdev-mcp-laravel-smoke-"));
const fakeProjectRoot = path.join(temporaryRoot, "fake-laravel");
const projectsFile = path.join(temporaryRoot, "projects.json");
const testSecret = "localdev-test-secret-value";

try {
  await mkdir(fakeProjectRoot, { recursive: true });
  await writeFile(path.join(fakeProjectRoot, "artisan"), "", "utf8");
  await writeFile(path.join(fakeProjectRoot, ".env"), `TEST_APP_SECRET=${testSecret}\n`, "utf8");
  await writeFile(projectsFile, JSON.stringify({
    projects: {
      "fake-laravel": {
        root: fakeProjectRoot,
        stack: ["laravel"],
        allowedSecretEnvKeys: ["TEST_APP_SECRET"],
        readOnlyArtisanCommands: ["custom:readiness"],
      },
    },
  }, null, 2), "utf8");
  process.env.LOCALDEV_MCP_PROJECTS = projectsFile;

  const {
    localHttpRequest,
    localSecretOperation,
  } = await import("./lib/laravel-integration.js");
  const { runDirectProcess } = await import("./lib/process.js");
  const {
    assertArtisanExecutionAllowed,
    classifyArtisanCommand,
    inspectTinkerCode,
  } = await import("./security/laravel-policy.js");
  const { getProject } = await import("./config.js");

  const project = await getProject("fake-laravel");

  const parsedJson = parseJsonDocument("NOTICE: local framework banner\n{\"status\":\"DRY_RUN_READY\",\"nested\":{\"ok\":true}}\nDONE");
  if (!isRecord(parsedJson) || parsedJson.status !== "DRY_RUN_READY") {
    throw new Error("Noisy JSON command output was not parsed correctly.");
  }

  if (classifyArtisanCommand("custom:readiness", project) !== "READ_ONLY") {
    throw new Error("Configured custom Artisan command was not classified as READ_ONLY.");
  }
  let dangerousArtisanBlocked = false;
  try {
    assertArtisanExecutionAllowed({
      command: "migrate:fresh",
      project,
      confirmWrite: false,
    });
  } catch {
    dangerousArtisanBlocked = true;
  }
  if (!dangerousArtisanBlocked) throw new Error("Dangerous Artisan command was not blocked.");

  let externalArtisanBlocked = false;
  try {
    assertArtisanExecutionAllowed({
      command: "schedule:run",
      project,
      confirmWrite: true,
    });
  } catch {
    externalArtisanBlocked = true;
  }
  if (!externalArtisanBlocked) throw new Error("External-side-effect Artisan command was not blocked.");

  let customWriteBlocked = false;
  try {
    assertArtisanExecutionAllowed({
      command: "custom:write-operation",
      project,
      confirmWrite: false,
    });
  } catch {
    customWriteBlocked = true;
  }
  if (!customWriteBlocked) throw new Error("Unapproved custom Artisan write was not blocked.");
  if (assertArtisanExecutionAllowed({ command: "custom:write-operation", project, confirmWrite: true }) !== "REVERSIBLE_LOCAL_WRITE") {
    throw new Error("Approved custom Artisan write was not classified correctly.");
  }

  if (inspectTinkerCode("return App\\Models\\User::query()->count();").databaseWriteDetected) {
    throw new Error("Read-only Tinker code was classified as a database write.");
  }
  if (!inspectTinkerCode("$model->update(['name' => 'x']);").databaseWriteDetected) {
    throw new Error("Database-writing Tinker code was not detected.");
  }
  const blockedTinkerSamples = [
    "shell_exec('whoami');",
    "file_get_contents(base_path('.env'));",
    "config();",
    "Illuminate\\Support\\Facades\\DB::select('select 1');",
    "Illuminate\\Support\\Facades\\Artisan::call('about');",
  ];
  for (const code of blockedTinkerSamples) {
    let blocked = false;
    try {
      inspectTinkerCode(code);
    } catch {
      blocked = true;
    }
    if (!blocked) throw new Error(`Dangerous Tinker code was not blocked: ${code}`);
  }

  const payload = "exact-local-payload";
  const secretResult = await localSecretOperation({
    project: "fake-laravel",
    cwd: ".",
    envKey: "TEST_APP_SECRET",
    operation: "hmac_sha256",
    payload,
    outputEncoding: "hex_with_algorithm_prefix",
  });
  const expectedHmac = `sha256=${createHmac("sha256", testSecret).update(payload).digest("hex")}`;
  if (secretResult.result !== expectedHmac) throw new Error("HMAC result was incorrect.");
  if (JSON.stringify(secretResult).includes(testSecret)) throw new Error("Secret value leaked into the operation result.");

  const server = http.createServer((request, response) => {
    if (request.url === "/redirect") {
      response.statusCode = 302;
      response.setHeader("Location", "https://example.com/");
      response.end();
      return;
    }
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Set-Cookie", "session=private-value");
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("HTTP smoke server did not expose a port.");

  try {
    const allowedResponse = await localHttpRequest({
      project: "fake-laravel",
      method: "GET",
      url: `http://127.0.0.1:${address.port}/ok`,
      timeoutSeconds: 5,
      followRedirects: false,
      expectedStatuses: [200],
    });
    if (allowedResponse.assertionPassed !== true || allowedResponse.status !== 200) {
      throw new Error("Loopback HTTP request failed.");
    }
    const responseHeaders = allowedResponse.headers as Record<string, string>;
    if (responseHeaders["set-cookie"] !== "[REDACTED]") {
      throw new Error("Sensitive response header was not redacted.");
    }

    let externalBlocked = false;
    try {
      await localHttpRequest({
        project: "fake-laravel",
        method: "GET",
        url: "https://example.com/",
        timeoutSeconds: 5,
        followRedirects: false,
      });
    } catch {
      externalBlocked = true;
    }
    if (!externalBlocked) throw new Error("External HTTP request was not blocked.");

    let redirectBlocked = false;
    try {
      await localHttpRequest({
        project: "fake-laravel",
        method: "GET",
        url: `http://127.0.0.1:${address.port}/redirect`,
        timeoutSeconds: 5,
        followRedirects: true,
      });
    } catch {
      redirectBlocked = true;
    }
    if (!redirectBlocked) throw new Error("Loopback redirect to an external host was not blocked.");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  const timedProcess = await runDirectProcess({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 2000)"],
    cwd: fakeProjectRoot,
    timeoutSeconds: 0.1,
  });
  if (!timedProcess.timedOut) throw new Error("Direct process timeout was not enforced.");

  const limitedProcess = await runDirectProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(200000))"],
    cwd: fakeProjectRoot,
    timeoutSeconds: 5,
    maxOutputChars: 1000,
  });
  if (!limitedProcess.outputLimitExceeded) throw new Error("Direct process output limit was not enforced.");

  console.log(JSON.stringify({
    ok: true,
    checks: [
      "noisy_json_command_output",
      "custom_artisan_read_only",
      "dangerous_artisan_blocked",
      "external_artisan_blocked",
      "custom_artisan_write_confirmation",
      "tinker_read_only_detection",
      "tinker_write_detection",
      "dangerous_tinker_blocked",
      "secret_hmac_correct",
      "secret_not_returned",
      "localhost_http_allowed",
      "external_http_blocked",
      "external_redirect_blocked",
      "sensitive_header_redacted",
      "process_timeout",
      "process_output_limit",
    ],
  }, null, 2));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
