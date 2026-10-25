# Security policy

Shomer runs with broad permissions on every website, so security reports are taken seriously.

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private vulnerability reporting
(_Security → Report a vulnerability_ on the repository page). Include:

- the version (from the dashboard's _About_ section) and browser,
- steps to reproduce or a proof-of-concept page,
- the impact you believe it has.

You'll get an acknowledgement within a few days. Fixes are released as soon as possible, and reporters are credited in the changelog unless they prefer otherwise.

## Scope

In scope: anything that lets a web page, a filter list or a crafted backup file read data from, change the behaviour of, or escalate privileges through Shomer; and bypasses of the fingerprint shield that recover an unprotected fingerprint.

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for the adversaries and mitigations Shomer is designed around, and its known limitations.
