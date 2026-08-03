# Security policy

## Supported versions

Security fixes are applied to the latest released version and the `main`
branch. Older releases may require upgrading to receive a fix.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue, discussion, or
pull request. Report it privately through
[GitHub Security Advisories](https://github.com/arouzbehani/baharsoft-fileserver/security/advisories/new).

Include the affected version, deployment configuration, reproduction steps,
and potential impact when possible. Do not include real uploaded documents,
credentials, tokens, or personal data. Maintainers will acknowledge the report,
investigate it, and coordinate disclosure after a fix is available.

## Deployment responsibility

Operators are responsible for HTTPS termination, network restrictions, secret
management, backups, access to persistent volumes, and timely upgrades. Never
place service-client credentials in a browser application or commit `.env`
files and runtime data to source control.
