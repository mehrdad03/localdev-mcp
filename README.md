# LocalDev MCP

[![CI](https://github.com/mehrdad03/localdev-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mehrdad03/localdev-mcp/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A guarded, performance-focused Model Context Protocol server that lets an MCP client inspect, edit, test, and validate approved local development projects without exposing an unrestricted shell.

It was built for practical Laravel, PHP, Vue, Vite, Node.js, TypeScript, and Chrome Extension workflows, with explicit project-root confinement and defensive checks around file writes and commands.

## Highlights

- **36 focused MCP tools** for project discovery, code search, safe editing, Git inspection, tests, builds, Laravel diagnostics, and validation.
- **Project allowlisting** through a local configuration file.
- **SHA-256 concurrency protection** before modifying, replacing, renaming, or deleting existing files.
- **Batch operations** for fast reads and multi-file patches with rollback attempts.
- **Guarded Git branch switching** with clean-tree checks, branch-name validation, expected-HEAD verification, and dry-run support.
- **Command allowlists** instead of arbitrary shell access.
- **Secret-aware path blocking and output redaction**.
- **Cached project snapshots** and optional ripgrep acceleration.

## Architecture

```text
MCP Client
   |
   v
LocalDev MCP (stdio)
   |
   +-- Project configuration allowlist
   +-- Path and secret guards
   +-- SHA-256 write protection
   +-- Command policy allowlists
   +-- Audit, backup, and cache layers
   |
   v
Approved local repositories only
```

## Tool groups

### Project discovery and reading

`list_projects`, `get_project_info`, `get_project_snapshot`, `get_project_tree`, `list_directory`, `read_file`, `batch_read_files`, `search_files`, `search_code`

### Safe file editing

`write_file`, `create_file`, `replace_text`, `apply_patch`, `batch_apply_patches`, `rename_file`, `delete_file`

### Git and validation

`git_status`, `git_diff`, `git_switch_branch`, `inspect_changed_files`, `run_command`, `run_tests`, `run_validation_plan`

### Laravel and PHP

`read_laravel_logs`, `inspect_routes`, `inspect_database_schema`, `run_artisan`, `run_phpunit`, `run_pest`, `composer_install`, `clear_laravel_cache`, `restart_queue_workers`

### Frontend and Node.js

`run_npm`, `run_eslint`, `run_build`, `npm_install`

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

Copy the example configuration:

### Windows PowerShell

```powershell
Copy-Item projects.example.json projects.json
```

### macOS or Linux

```bash
cp projects.example.json projects.json
```

Edit `projects.json` and list only the local repositories the MCP server may access:

```json
{
  "projects": {
    "my-laravel-app": {
      "root": "C:\\Projects\\my-laravel-app",
      "stack": ["laravel", "vue", "vite"]
    }
  }
}
```

`projects.json` is ignored by Git so local paths are not published.

An alternative configuration file can be supplied through:

```text
LOCALDEV_MCP_PROJECTS=/absolute/path/to/projects.json
```

On Windows, set a custom PHP executable when PHP is not available through `PATH`:

```powershell
$env:LOCALDEV_MCP_PHP = "C:\path\to\php.exe"
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
npm run benchmark
```

The integration smoke test exercises LocalDev MCP itself and does not depend on any private application repository.

## Security defaults

- Only roots listed in the local project configuration are accessible.
- Absolute target paths and `..` traversal are rejected.
- `.env`, credentials, private keys, `.git`, `vendor`, and `node_modules` are blocked from file tools.
- Existing-file changes require the SHA-256 value returned by a read tool.
- Patch, replace, rename, and delete operations create local backups.
- Batch patching validates every target before writing and attempts rollback after partial failure.
- Arbitrary executables, shell operators, deployments, production flags, destructive database operations, and destructive Git commands are blocked.
- Laravel logs and compact command output redact common token and password patterns.
- Commands are audited locally under `logs/audit.log`.

See [SECURITY.md](SECURITY.md) for the security model and reporting guidance.

## Deliberate limitations

LocalDev MCP is intentionally not a general terminal, deployment agent, browser automation system, or operating-system sandbox. Its purpose is to provide a useful local coding workflow while keeping the exposed capability surface narrow and reviewable.

## Example workflow

```text
1. get_project_snapshot
2. search_code / batch_read_files
3. apply_patch / batch_apply_patches
4. run_tests / run_validation_plan
5. inspect_changed_files
6. git_switch_branch when a clean branch transition is required
```

## License

MIT License. See [LICENSE](LICENSE).
