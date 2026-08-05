# Baharsoft File Server

An open-source, self-hosted, multi-tenant document storage service for
application backends.

[![CI](https://github.com/arouzbehani/baharsoft-fileserver/actions/workflows/ci.yml/badge.svg)](https://github.com/arouzbehani/baharsoft-fileserver/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/arouzbehani/baharsoft-fileserver)](https://github.com/arouzbehani/baharsoft-fileserver/releases)
[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)

Baharsoft File Server stores binaries on a local volume and metadata in SQLite.
It provides tenant isolation, stable document IDs, tags, lifecycle operations,
service-client credentials, and an administrator console. Each consuming
application keeps its users, business records, permissions, and workflows in
its own database.

This project is deployable software, not a hosted SaaS offering. Application
backends call it using short-lived service tokens; application frontends should
not receive service credentials or call protected file routes directly.

## Requirements

- Node.js 22 or newer
- A writable data directory
- A writable binary-storage directory

## Local setup

1. Copy `.env.example` to `.env`.
2. Set `FILESERVER_TOKEN_SIGNING_SECRET` to an independent random value of at
   least 32 characters. This server-only value is not a client credential.
3. Install and run the service:

```powershell
npm ci
npm test
npm start
```

The default address is `http://localhost:3000`.

## Administration console

The administrator console is available at
`http://localhost:3000/<FILESERVER_ADMIN_PATH>/` after its frontend has been
built. `FILESERVER_ADMIN_PATH` defaults to `/admin`, but production
installations should configure a unique single-segment path. On first use, the
console asks you to create the local administrator account; afterward it
provides login and service-client management. The first administrator can be
created only once.

The Files workspace provides generic operational control across configured
tenants. Administrators can filter files by lifecycle status, folder,
visibility, filename, document ID, and tags; inspect metadata and checksums;
preview images and PDFs; download or upload files; and soft-delete or restore
documents. Permanent purge is available only for an already-deleted document
and requires typing its filename as confirmation. Project-specific users,
cases, review comments, and workflow data do not belong in this console.

Install the UI dependencies once:

```powershell
npm run admin:install
```

For local development, run the API and UI in separate terminals:

```powershell
# Terminal 1
npm start

# Terminal 2
npm run admin:dev
```

Open `http://localhost:5173/`. The development server proxies management
requests to the API. To build the UI and serve it from the file server instead:

```powershell
npm run admin:build
npm start
```

After building, verify the served console and its API without changing your
local database:

```powershell
npm run admin:smoke
```

The console uses an HTTP-only local administrator session. It is separate from
service-client credentials and from the authentication used by consuming
projects.

## Container deployment

The generic deployment package builds the API and admin console into one
non-root Docker image. The provided Compose configuration keeps SQLite,
stored binaries, and quarantine data in separate persistent volumes and binds
to localhost by default. Production first-run setup requires a separate
bootstrap token so an exposed new installation cannot be claimed by an
unauthorized visitor.

See [Container deployment](docs/deployment.md) for configuration, local image
testing, Linux installation, HTTPS reverse proxying, persistence, backups,
upgrades, and first-administrator setup.

The versioned container is published at:

```text
ghcr.io/arouzbehani/baharsoft-fileserver:<version>
```

Maintainers should follow [Releasing](docs/releasing.md) when publishing a
versioned container image and deployment kit.

## Runtime configuration

| Variable | Required | Default |
| --- | --- | --- |
| `NODE_ENV` | No | `development` |
| `PORT` | No | `3000` |
| `FILESERVER_TOKEN_SIGNING_SECRET` | Yes | None |
| `FILESERVER_TOKEN_ISSUER` | No | `baharsoft-fileserver` |
| `FILESERVER_TOKEN_AUDIENCE` | No | `baharsoft-fileserver` |
| `FILESERVER_TOKEN_TTL_SECONDS` | No | `300` |
| `FILESERVER_ADMIN_SESSION_TTL_SECONDS` | No | `28800` (8 hours) |
| `FILESERVER_DATA_ROOT` | No | `./data` |
| `FILESERVER_STORAGE_ROOT` | No | `./storage/tenants` |
| `FILESERVER_DB_PATH` | No | `<data root>/fileserver.sqlite` |
| `FILESERVER_QUARANTINE_ROOT` | No | `<data root>/quarantine` |

## Backend service authentication

The file server does not authenticate an application's users. A project may use
Keycloak, Entra ID, local accounts, or any other user-authentication system. Its
backend performs business authorization and communicates with the file server
as a separately registered service client.

Create a service client before starting integration:

```powershell
npm run client:create -- `
  --client-id baharsoft-demo-api `
  --name "Baharsoft Demo API" `
  --tenants baharsoft-demo `
  --permissions upload,read,delete,restore
```

The generated `clientSecret` is displayed once. Store it in the calling
backend's secret manager. Only a salted hash is retained by the file server.

Exchange the client credentials for a short-lived token:

```text
POST /auth/token
Authorization: Basic base64(clientId:clientSecret)
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
```

The response contains a bearer token used on protected file routes. Tokens are
restricted to the client's configured tenants and permissions. Rotating a
secret or disabling a client immediately revokes its previously issued tokens.

```powershell
npm run client:list
npm run client:update -- --client-id baharsoft-demo-api --tenants baharsoft-demo --permissions upload,read
npm run client:rotate -- --client-id baharsoft-demo-api
npm run client:disable -- --client-id baharsoft-demo-api
npm run client:enable -- --client-id baharsoft-demo-api
```

Application frontends must not receive service credentials or call protected
file APIs. A backend should proxy private downloads. Public file URLs may be
read without authentication; short-lived signed download URLs can be added in
a later milestone.

## Operational endpoints

- `GET /health/live` reports whether the Node.js process is running.
- `GET /health/ready` verifies that the metadata database is available.

Runtime databases, uploaded binaries, environment files, and logs must not be
committed. Provision them as persistent deployment data and back them up
together.

## Secure file I/O

- Upload bodies are written under a non-public quarantine directory first.
- Tenant, folder, and filename segments are validated before publication.
- Content type and size validation completes before the final path is changed.
- Uploads do not overwrite existing files by default. A caller must explicitly
  send `?overwrite=true` to replace a file.
- Failed metadata writes roll the binary publication back; explicit overwrite
  rollback restores the previous binary.
- Symbolic-link files and storage subdirectories are not served.

Quarantine, final binary storage, and the SQLite database must use separate
paths. Invalid or incomplete uploads are removed from quarantine.

## Document metadata and tags

Uploads may include an optional multipart field named `metadata`. Its value is
a JSON object; the file itself remains in the `file` field.

```json
{
  "tags": [
    { "key": "documentType", "value": "passport" },
    { "key": "origin", "value": "translation" },
    { "key": "language", "value": "fa" }
  ]
}
```

A document can have up to 20 key/value tags, including multiple values for the
same key. Project relationships and business metadata—such as users, cases,
expiration dates, comments, or workflow status—belong in the calling
application's database. That application stores the returned `documentId` as
its only link to the file server.

Each new upload receives a stable UUID in `file.documentId` and a SHA-256 value
in `file.checksumSha256`. The existing numeric `file.id` remains available for
backward compatibility. Delete and restore routes accept either identifier.
The stable read/download URL is:

```text
GET /files/document/{tenant}/{documentId}
```

The older path-based read route remains available for compatibility, but new
integrations should store and use `documentId` rather than storage paths.

To find documents with all requested tags, repeat the `tag` query parameter:

```text
GET /files/list/baharsoft-demo?tag=documentType:passport&tag=origin:translation
```

An overwrite without a `metadata` field preserves the existing tags. Supplying
`metadata` replaces them; an empty object therefore clears them.

## Commands

```powershell
npm run check
npm test
npm run verify
npm run verify:full
npm start
```

Use `npm run verify` before committing each branch. It runs syntax validation
and the complete automated test suite. Use `npm run verify:full` before merging;
it additionally checks production dependencies for known vulnerabilities.

With the server running in another terminal, verify its real dependencies and
HTTP health endpoints:

```powershell
npm run smoke
```

To check a non-default address, set `FILESERVER_BASE_URL` for the command:

```powershell
$env:FILESERVER_BASE_URL="http://127.0.0.1:8080"
npm run smoke
```

## Project policies

- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [ISC license](LICENSE)
