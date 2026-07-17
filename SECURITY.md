# Security Policy

LocalDev MCP is designed to expose a deliberately limited local-development surface to an MCP client.

## Security model

- Only project roots explicitly listed in the local `projects.json` configuration are accessible.
- File access is restricted to project-relative paths and blocks parent-directory traversal.
- Secret-like files, dependency directories, Git internals, and common private-key formats are blocked.
- Existing-file changes require SHA-256 version checks.
- Delete and rename operations create local backups.
- Commands use allowlists; unrestricted shell execution, deployment commands, production flags, destructive database actions, and destructive Git operations are not exposed.
- Command output and Laravel logs pass through basic secret redaction.

## Reporting a vulnerability

Please report security issues privately through the repository owner's GitHub profile rather than opening a public issue containing exploit details or credentials.

Do not include real API keys, access tokens, passwords, private keys, production logs, or customer data in a report.

## Scope note

This project reduces risk but does not create a security boundary equivalent to an operating-system sandbox. Run it only on a trusted development machine and review the configured project roots before starting the server.
