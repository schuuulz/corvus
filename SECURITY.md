# Security policy

## Supported versions

Only the latest release receives security fixes. The app updates itself, so staying current is usually automatic.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report them privately through GitHub instead: **Security → Report a vulnerability** on this repository ([direct link](https://github.com/schuuulz/corvus/security/advisories/new)).

Helpful details:

- the Corvus version and operating system;
- what an attacker controls (a repository, a branch name, a remote, a file) and what they gain;
- steps or a minimal repository that reproduce it.

You can expect an acknowledgement within a few days. Fixes ship as a regular release, and the advisory is published once users have had the chance to update.

## Scope

Corvus runs git and shell commands on your machine, so the most relevant reports involve content from an untrusted repository or remote leading to code execution, file access outside the repository, or leaked credentials.

Git's own behaviour is out of scope. For example, hooks and config inside a repository you open are honoured, as they are by the git CLI.
