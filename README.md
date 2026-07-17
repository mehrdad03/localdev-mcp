# LocalDev MCP

[![CI](https://github.com/mehrdad03/localdev-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mehrdad03/localdev-mcp/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A secure and performance-focused Model Context Protocol server that allows AI assistants to inspect, edit, test, and validate approved local software projects.

LocalDev MCP can be used with different programming languages, frameworks, and project types. It restricts access to explicitly approved project folders and applies safety checks to file changes, Git operations, and command execution.

## Highlights

- **39 focused MCP tools** for project discovery, centrally installed skills, code search, safe editing, Git inspection, tests, builds, Laravel diagnostics, and validation.
- **Project allowlisting** through a local configuration file.
- **SHA-256 concurrency protection** before modifying, replacing, renaming, or deleting existing files.
- **Batch operations** for fast reads and multi-file patches with rollback attempts.
- **Guarded Git branch switching** with clean-tree checks, branch-name validation, expected-HEAD verification, and dry-run support.
- **Command allowlists** instead of arbitrary shell access.
- **Secret-aware path blocking and output redaction**.
- **Cached project snapshots** and optional ripgrep acceleration.
- **MCP-native skill registry** with progressive disclosure through `list_skills`, `get_skill`, and `read_skill_reference`.
- **Bundled Frontend Craft Director** for design, redesign, implementation, responsive fixes, anti-AI-slop review, and rendered visual QA.
- **Configurable command timeouts up to 3,600 seconds (one hour)** for long-running builds, tests, installs, and validation workflows.

## Architecture

```text
MCP Client
   |
   v
LocalDev MCP (stdio)
   |
   +-- Project configuration allowlist
   +-- Central MCP-native skill registry
   +-- Path and secret guards
   +-- SHA-256 write protection
   +-- Command policy allowlists
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

### Safe file editing

`write_file`, `create_file`, `replace_text`, `apply_patch`, `batch_apply_patches`, `rename_file`, `delete_file`

### Git and validation

`git_status`, `git_diff`, `git_switch_branch`, `inspect_changed_files`, `run_command`, `run_tests`, `run_validation_plan`

### Laravel and PHP

`read_laravel_logs`, `inspect_routes`, `inspect_database_schema`, `run_artisan`, `run_phpunit`, `run_pest`, `composer_install`, `clear_laravel_cache`, `restart_queue_workers`

### Frontend and Node.js

`run_npm`, `run_eslint`, `run_build`, `npm_install`

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

The MCP client should call:

```text
list_skills
get_skill(name: "frontend-craft-director")
read_skill_reference(skill: "frontend-craft-director", reference: "references/visual-qa.md")
```

`get_skill` returns the complete self-contained skill. `read_skill_reference` provides focused supporting references and the `templates/DESIGN.md` contract when progressive disclosure is preferable.

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
1. get_skill when a governing workflow applies
2. get_project_snapshot
3. search_code / batch_read_files
4. apply_patch / batch_apply_patches
5. run_tests / run_validation_plan
6. inspect_changed_files
7. git_switch_branch when a clean branch transition is required
```

## License

MIT License. See [LICENSE](LICENSE).
