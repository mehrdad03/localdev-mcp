# LocalDev MCP

[![CI](https://github.com/mehrdad03/localdev-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mehrdad03/localdev-mcp/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A guarded Model Context Protocol server that lets AI assistants inspect, edit, test, and validate explicitly approved local software projects.

LocalDev MCP is designed for practical coding workflows without exposing a general-purpose terminal. File access, Git operations, process execution, Laravel integration testing, secrets, HTTP requests, and database inspection all use narrow, reviewable policies.

## Highlights

- **49 focused MCP tools** for project discovery, centrally installed skills, code search, safe editing, binary file import, Git inspection, tests, builds, Laravel diagnostics, integration testing, and validation.
- **Project allowlisting** through a local configuration file.
- **SHA-256 concurrency protection** before modifying, replacing, renaming, deleting, or overwriting existing files.
- **Direct binary file import** from mounted MCP file inputs without Base64 conversion, with source-root allowlisting and MIME/hash verification.
- **Batch operations** for fast reads and multi-file patches with rollback attempts.
- **Guarded Git branch switching** with clean-tree checks, branch-name validation, expected-HEAD verification, and dry-run support.
- **Risk-classified custom Artisan commands** instead of unrestricted shell execution.
- **Guarded multiline Laravel Tinker execution** through ephemeral scripts outside the target repository.
- **In-memory HMAC and digest operations** using explicitly approved `.env` keys without returning the secret value.
- **Loopback-only HTTP requests** with redirect revalidation and sensitive-header redaction.
- **Managed temporary Laravel servers** that can automatically select an available loopback port and can stop only processes started by the same MCP instance.
- **Structured database snapshots and assertions** without model-supplied raw SQL.
- **Secret-aware path blocking and output redaction**.
- **MCP-native skill registry** with progressive disclosure through `list_skills`, `get_skill`, and `read_skill_reference`.
- **Bundled Frontend Craft Director** for design, redesign, implementation, responsive fixes, anti-AI-slop review, and rendered visual QA.
- **Configurable command timeouts up to 3,600 seconds** for long-running builds, tests, installs, and validation workflows.

## Architecture

```text
MCP Client
   |
   v
LocalDev MCP (stdio)
   |
   +-- Project configuration allowlist
   +-- Central MCP-native skill registry
   +-- Path, upload-source, and secret guards
   +-- SHA-256 write and binary-import protection
   +-- Command and Laravel risk policies
   +-- Loopback HTTP enforcement
   +-- Managed-process ownership
   +-- Audit, backup, and cache layers
   |
   v
Approved local repositories only
```

## Tool groups

### Skills

`list_skills`, `get_skill`, `read_skill_reference`

### Project discovery and reading

`list_projects`, `get_project_info`, `get_project_snapshot`, `get_project_tree`, `list_directory`, `read_file`, `batch_read_files`, `search_files`, `search_code`

### Safe file editing and import

`import_file_to_project`, `write_file`, `create_file`, `replace_text`, `apply_patch`, `batch_apply_patches`, `rename_file`, `delete_file`

### Git and validation

`git_status`, `git_diff`, `git_switch_branch`, `inspect_changed_files`, `run_command`, `run_tests`, `run_validation_plan`

### Laravel and PHP

`read_laravel_logs`, `inspect_routes`, `inspect_database_schema`, `run_artisan`, `laravel_run_artisan`, `laravel_tinker_execute`, `laravel_database_snapshot`, `laravel_database_assert`, `run_phpunit`, `run_pest`, `composer_install`, `clear_laravel_cache`, `restart_queue_workers`

### Local Laravel integration testing

`local_secret_operation`, `local_http_request`, `start_local_process`, `inspect_local_process`, `stop_local_process`

### Frontend and Node.js

`run_npm`, `run_eslint`, `run_build`, `npm_install`

## Binary file import

`import_file_to_project` accepts a real MCP file input in `source_file` and copies the mounted file directly into an allowlisted project. Binary data is streamed as bytes; it is never converted to Base64 or passed through text encoding.

Inputs:

- `project`: configured project key.
- `source_file`: uploaded file input advertised to the MCP client with schema `type: "file"`.
- `destination`: project-relative destination. Absolute paths, `..` traversal, secret-like destinations, and symlink escapes are rejected.
- `overwrite`: defaults to `false`. Existing files are refused unless explicitly enabled.
- `createParents`: defaults to `true`.
- `expectedSha256`: optional concurrency check for the existing destination when overwriting.

The result contains `path`, `size`, `mimeType`, and `sha256`. PNG, JPEG, WEBP, SVG, PDF, and common additional formats are detected from file signatures when available, with extension fallback for unknown data.

Uploaded source paths must be inside an approved mount root. By default, LocalDev MCP accepts files under the operating system temporary directory. Set one or more explicit roots when the tunnel mounts uploads elsewhere:

```text
LOCALDEV_MCP_IMPORT_ROOTS=C:\path\to\tunnel\uploads
```

On Windows, separate multiple roots with `;`; on macOS or Linux, use `:`. The default maximum import size is 100 MiB. It can be changed up to 1 GiB:

```text
LOCALDEV_MCP_MAX_IMPORT_BYTES=209715200
```

Secret-like source names such as `.env`, private-key formats, and credential files are rejected. Overwrites create a local binary backup before replacement and verify the final destination hash.

## Laravel integration workflow

### Custom Artisan commands

`laravel_run_artisan` classifies commands as:

- `READ_ONLY`
- `REVERSIBLE_LOCAL_WRITE`
- `IRREVERSIBLE_LOCAL_WRITE`
- `EXTERNAL_SIDE_EFFECT`

Unknown project-specific commands are not assumed to be harmless. Add known read-only commands to `readOnlyArtisanCommands`; otherwise explicit approval is required for reversible local writes. Irreversible database commands and long-running or external-side-effect Artisan commands are blocked; dedicated MCP process tools must be used where available. Production flags such as `--force` and `--env` remain blocked.

Both `run_artisan` and `laravel_run_artisan` accept project-specific commands explicitly configured as read-only. Generic `run_command` deliberately keeps `php artisan tinker` and `php -r` blocked and directs callers to the dedicated Laravel tools instead.

JSON output mode accepts a valid JSON document even when the framework prints notices before or after it.

### Guarded multiline Tinker

`laravel_tinker_execute`:

- Executes multiline PHP through an ephemeral script outside the repository.
- Removes the temporary script in `finally`.
- Disables process, filesystem, network, dynamic-loading, and environment-access functions.
- Blocks raw SQL and secret-file access patterns.
- Detects common database-write operations and requires `allowDatabaseWrite=true`.
- Supports `none`, `rollback`, and `commit` transaction modes.
- Returns only sanitized output and a SHA-256 hash of the submitted code in audit records.

For tests that must expose a temporary database change to a second process, snapshot the original value, apply the reviewed change, and restore the exact snapshot in a `finally` step. For single-process temporary changes, use `transactionMode: "rollback"`.

### Secrets and HMAC

`local_secret_operation` can use only keys listed in `allowedSecretEnvKeys` for the selected project. The secret value:

- Is read directly from `.env` into memory.
- Is not returned to the MCP client.
- Is not written to a temporary file.
- Is not placed on the command line.
- Is not included in audit logs.
- Is used only for the requested presence check, HMAC, or digest operation.

### Loopback-only HTTP

`local_http_request` accepts only:

```text
localhost
127.0.0.1
::1
```

The host must resolve exclusively to loopback addresses. Redirect targets are validated again before following them. Requests to public domains, private-network addresses, or other IPs are rejected. Authorization, cookie, API-key, and webhook-signature headers are redacted from returned metadata.

### Managed Laravel server

`start_local_process` starts only `php artisan serve` on a loopback host. Set `port: 0` to select an available ephemeral port automatically. Explicit occupied ports are rejected.

`stop_local_process` accepts only a session ID created by the same MCP server instance for the same project. LocalDev MCP does not adopt or terminate unrelated operating-system processes.

### Database assertions

`laravel_database_snapshot` and `laravel_database_assert` accept structured table, column, equality-filter, ordering, and bounded-limit inputs. Raw SQL is not accepted.

## MCP-native skills

Skills live under `skills/<skill-name>/` and are available to every configured project without copying them into application repositories.

The bundled skill is:

```text
frontend-craft-director
```

Recommended frontend invocation:

```text
@LocalDev

Project: <project-key>

Use the frontend-craft-director skill as the mandatory workflow for this frontend task.
Load the skill before editing files, inspect the real repository, produce a Design Read,
preserve routes/APIs/behavior, do not install packages without approval, run repository
validation, and report rendered visual-QA evidence honestly.
```

## Requirements

- Node.js 22 or newer
- npm
- Git
- Optional: PHP and Composer for Laravel/PHP projects
- Optional: ripgrep (`rg`) for faster code search

## Installation

```bash
git clone https://github.com/mehrdad03/localdev-mcp.git
cd localdev-mcp
npm ci
npm run typecheck
npm run build
npm run smoke
```

## Configure approved projects

Copy the example to a private local configuration:

### Windows PowerShell

```powershell
Copy-Item projects.example.json projects.local.json
```

### macOS or Linux

```bash
cp projects.example.json projects.local.json
```

`projects.local.json` is preferred automatically when it exists. Otherwise LocalDev MCP falls back to `projects.json`. Both names are ignored by Git.

Example Laravel project configuration:

```json
{
  "projects": {
    "my-laravel-app": {
      "root": "C:\\Projects\\my-laravel-app",
      "stack": ["laravel", "vue", "vite"],
      "phpExecutable": "C:\\path\\to\\php.exe",
      "allowedSecretEnvKeys": ["WEBHOOK_APP_SECRET"],
      "readOnlyArtisanCommands": ["integration:readiness"]
    }
  }
}
```

Configuration fields:

- `root`: approved project root.
- `stack`: descriptive project stack.
- `phpExecutable`: optional project-specific PHP executable.
- `allowedSecretEnvKeys`: `.env` keys approved only for in-memory secret operations and output redaction.
- `readOnlyArtisanCommands`: project-specific commands that are verified to be read-only.

An alternative configuration file can be supplied through:

```text
LOCALDEV_MCP_PROJECTS=/absolute/path/to/projects.json
```

## Run the server

```bash
npm start
```

The server communicates over MCP stdio. Configure the MCP client to launch:

```text
command: node
args: [<absolute-path>/dist/index.js]
```

## Validation

```bash
npm run typecheck
npm run build
npm run smoke
npm run integration-smoke
npm run laravel-tools-smoke
npm run file-import-smoke
npm run benchmark
```

The generic smoke suites are self-contained and do not depend on private application repositories.

## Security defaults

- Only roots listed in the selected local project configuration are accessible.
- Absolute target paths and `..` traversal are rejected.
- File imports accept sources only from configured upload roots, reject source and destination symlinks, and stream bytes without Base64 conversion.
- `.env`, credentials, private keys, `.git`, `vendor`, and `node_modules` are blocked from normal file tools and imports.
- Existing-file changes require the SHA-256 value returned by a read tool; binary imports support the same check when overwriting.
- Patch, replace, rename, and delete operations create local backups.
- Batch patching validates every target before writing and attempts rollback after partial failure.
- Arbitrary executables, shell operators, deployments, production flags, destructive database operations, and destructive Git commands are blocked or require explicit risk-specific confirmation.
- Tinker code cannot directly access files, environment variables, network sockets, process functions, or raw SQL execution helpers.
- HTTP integration requests are restricted to loopback hosts and revalidate redirects.
- Commands and sensitive operations are audited locally under `logs/audit.log` without recording approved secret values.

See [SECURITY.md](SECURITY.md) for the security model and reporting guidance.

## Deliberate limitations

LocalDev MCP is not an operating-system sandbox, deployment agent, browser automation platform, or unrestricted terminal. Run it only on a trusted development machine, keep the project allowlist narrow, and review write approvals before execution.

## Example workflow

```text
1. get_skill when a governing workflow applies
2. get_project_snapshot
3. search_code / batch_read_files
4. apply_patch / batch_apply_patches
5. laravel_run_artisan / laravel_tinker_execute when integration work requires them
6. start_local_process -> local_http_request -> database assertions -> stop_local_process
7. restore temporary state in finally
8. run_tests / run_validation_plan
9. inspect_changed_files
10. git_switch_branch when a clean branch transition is required
```

## License

MIT License. See [LICENSE](LICENSE).
