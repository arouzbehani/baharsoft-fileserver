# Contributing

Thank you for helping improve Baharsoft File Server.

## Development setup

Use Node.js 22 or newer. Fork or clone the repository, then install and verify
the API and administrator console:

```powershell
npm ci
npm --prefix admin-ui ci
npm run verify
npm run admin:build
```

Copy `.env.example` to `.env` only for local runtime testing. Never commit that
file, uploaded documents, SQLite databases, secrets, tokens, logs, or data from
a real customer or project.

## Pull requests

- Keep a pull request focused on one change.
- Add or update automated tests for behavior changes.
- Use generic Baharsoft demo values in tests, documentation, and screenshots.
- Run `npm run verify:full` and `npm run admin:build` before requesting review.
- Describe database migrations, security implications, and deployment changes
  explicitly.

Bug reports and feature proposals are welcome in GitHub Issues. Security
reports must follow [SECURITY.md](SECURITY.md) instead.
