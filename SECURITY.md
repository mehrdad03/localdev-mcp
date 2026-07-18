# Security Policy

LocalDev MCP exposes a deliberately narrow local-development surface to an MCP client. It reduces accidental and agent-driven risk, but it is not an operating-system sandbox.

## Security model

- Only project roots explicitly listed in the selected `projects.local.json`, `projects.json`, or `LOCALDEV_MCP_PROJECTS` configuration are accessible.
- File access is project-relative and rejects parent-directory traversal, absolute target paths, symlink escapes, secret-like files, dependency directories, Git internals, and common private-key formats.
- Existing-file writes require SHA-256 version checks. Replace, patch, rename, and delete operations keep local backups.
- Generic commands use executable and argument allowlists. Shell operators, arbitrary executables, deployment commands, production flags, and destructive Git operations are not exposed.
- Custom Artisan commands are risk-classified. Unknown commands require explicit write approval unless the project configuration marks them as read-only. Irreversible and external-side-effect Artisan commands are blocked; dedicated MCP tools must be used where available.
- Multiline Tinker code is executed through an ephemeral script outside the repository and the script is removed in `finally`.
- Tinker execution disables process, filesystem, socket, URL-loading, dynamic-loading, and environment-access functions. Raw SQL helpers and secret-file access patterns are blocked. Common database writes require explicit approval.
- `.env` remains blocked from normal file tools. `local_secret_operation` can read only explicitly approved keys and never returns, logs, writes, or places the secret value on a command line.
- HTTP integration requests accept only `localhost`, `127.0.0.1`, and `::1`. DNS results and every redirect target must remain loopback-only.
- Managed Laravel servers bind only to loopback hosts. The MCP can inspect or stop only process sessions it created for the same project and server instance.
- Structured database snapshot and assertion tools do not accept raw SQL.
- Command output, Laravel logs, managed-process output, and HTTP metadata pass through secret and sensitive-header redaction.
- Audit records include operation metadata, hashes, status, duration, and risk classification without approved secret values or submitted Tinker source.

## Operational guidance

- Run LocalDev MCP only on a trusted development machine.
- Keep the project allowlist narrow.
- Use a private `projects.local.json` for machine-specific paths and approved secret-key names.
- Configure only commands you have reviewed as `readOnlyArtisanCommands`.
- Keep production credentials and production databases outside projects used for local integration tests.
- Review explicit database-write and irreversible-operation confirmations before execution.
- Stop the MCP server when it is not needed.

## Reporting a vulnerability

Report security issues privately through the repository owner's GitHub profile rather than opening a public issue containing exploit details or credentials.

Do not include real API keys, access tokens, passwords, private keys, production logs, customer data, or unredacted `.env` contents in a report.

## Scope note

LocalDev MCP provides application-level guardrails. A trusted local process, dependency, PHP extension, framework command, or compromised development machine may still bypass those assumptions. The operating system, account permissions, network controls, and repository contents remain part of the security boundary.
