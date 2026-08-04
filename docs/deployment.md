# Container deployment

The supported generic deployment is one Baharsoft File Server container with
persistent Docker volumes. Consuming application backends communicate with the
container over HTTP; their frontends never receive service credentials.

## Requirements

- Docker Engine with Docker Compose v2
- A reverse proxy with HTTPS for any non-local deployment
- One host/container instance per file-server installation while SQLite and
  local binary storage are in use

## Prepare the environment

Copy the deployment template without committing the resulting `.env` file:

```powershell
Copy-Item deploy\.env.example deploy\.env
```

Generate two different secrets. This works in Windows PowerShell:

```powershell
function New-FileServerSecret {
    $bytes = New-Object byte[] 48
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    [Convert]::ToBase64String($bytes)
}

New-FileServerSecret # FILESERVER_TOKEN_SIGNING_SECRET
New-FileServerSecret # FILESERVER_ADMIN_BOOTSTRAP_TOKEN
"/control-$([guid]::NewGuid().ToString('N'))" # FILESERVER_ADMIN_PATH
```

Put the two values in `deploy/.env`. They have different purposes and must not
be the same:

- `FILESERVER_TOKEN_SIGNING_SECRET` signs short-lived service tokens.
- `FILESERVER_ADMIN_BOOTSTRAP_TOKEN` authorizes only the first administrator
  setup. The first-run screen asks for this value when the container runs in
  production.
- `FILESERVER_ADMIN_PATH` places both the administrator UI and API below one
  installation-specific path. Keep it stable across upgrades. A non-default
  path reduces automated scanning noise but does not replace authentication.

## Build and run from this repository

Until a registry release exists, build the exact source checkout locally:

```powershell
docker compose `
  --env-file deploy\.env `
  -f deploy\compose.yaml `
  -f deploy\compose.build.yaml `
  up -d --build --wait
```

Open `http://127.0.0.1:3000/<FILESERVER_ADMIN_PATH>/` and create the first
administrator using the bootstrap token. Do not include two slashes between
the hostname and configured path. To view status and logs:

```powershell
docker compose --env-file deploy\.env -f deploy\compose.yaml ps
docker compose --env-file deploy\.env -f deploy\compose.yaml logs -f fileserver
```

## Run a published release

After the release workflow publishes the image, set `FILESERVER_VERSION` to an
exact version and start the base Compose file:

```powershell
docker compose --env-file deploy\.env -f deploy\compose.yaml pull
docker compose --env-file deploy\.env -f deploy\compose.yaml up -d --wait
```

Production installations should pin an exact version such as `1.0.1`, not
`latest`.

## Install a release on a Linux server

The following example installs version `1.0.1` under
`/opt/baharsoft-fileserver`. Replace the version when installing a newer
release.

```bash
export FILESERVER_VERSION=1.0.1
sudo install -d -o "$USER" -g "$USER" /opt/baharsoft-fileserver
cd /opt/baharsoft-fileserver

curl -fLO "https://github.com/arouzbehani/baharsoft-fileserver/releases/download/v${FILESERVER_VERSION}/baharsoft-fileserver-${FILESERVER_VERSION}-deploy.tar.gz"
curl -fLO "https://github.com/arouzbehani/baharsoft-fileserver/releases/download/v${FILESERVER_VERSION}/baharsoft-fileserver-${FILESERVER_VERSION}-deploy.tar.gz.sha256"
sha256sum -c "baharsoft-fileserver-${FILESERVER_VERSION}-deploy.tar.gz.sha256"
tar -xzf "baharsoft-fileserver-${FILESERVER_VERSION}-deploy.tar.gz"
cp .env.example .env
```

Edit `.env`, keep the host binding on `127.0.0.1`, and generate two independent
secrets:

```bash
openssl rand -base64 48
openssl rand -base64 48
printf '/control-%s\n' "$(openssl rand -hex 16)"
```

Then pull and start the pinned image:

```bash
docker compose --env-file .env -f compose.yaml config --quiet
docker compose --env-file .env -f compose.yaml pull
docker compose --env-file .env -f compose.yaml up -d --wait
curl -fsS http://127.0.0.1:3000/health/ready
```

Set the third generated value as `FILESERVER_ADMIN_PATH`, then open that path
through the HTTPS hostname and use the bootstrap token to create the first
administrator. For example, a value of `/control-0123abcd` is opened as
`https://files.example.com/control-0123abcd/`. After setup, keep both secrets
in the server's secret management system. The bootstrap token cannot create
another first administrator after initialization.

## Update a Linux installation

Deployment kits include `update-fileserver.sh`. Run it from an existing
installation with the exact stable version to install; do not include the
leading `v`:

```bash
cd /opt/baharsoft-fileserver
./update-fileserver.sh 1.1.0
```

The updater downloads that version's deployment kit and checksum from the
official GitHub release, verifies the archive, and validates the new Compose
configuration. It preserves the installation's `.env` settings while changing
`FILESERVER_VERSION`, installs the release's current `compose.yaml`,
`.env.example`, and updater, pulls the pinned image, and waits for the service
health check. Set `FILESERVER_UPDATE_HEALTH_TIMEOUT_SECONDS` to a positive
number to override the default 180-second wait.

Before upgrading an installation created before configurable administrator
paths were available, add a unique `FILESERVER_ADMIN_PATH` value to its `.env`.
If it is omitted, the backward-compatible `/admin` default remains active.

To bootstrap an installation from before deployment kits included the updater,
copy the current `update-fileserver.sh` into the installation directory and run
it normally. If the target release kit has no updater, the script retains its
installed copy instead of failing. A later release kit that contains an updater
replaces it with that release's versioned copy.

The updater does **not** back up persistent volumes. Volume backups are a
separate operator responsibility and are required before every upgrade whose
release notes include a schema change. Back up all three volumes as one
consistent set before running the updater; a rollback across a schema change
also requires restoring the matching pre-upgrade volume backup.

## Nginx HTTPS reverse proxy

With the default local binding, an Nginx virtual host can proxy a generic
hostname such as `files.example.com` to the container:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name files.example.com;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 15s;
        proxy_read_timeout 300s;
        proxy_request_buffering off;
    }
}
```

Validate and reload Nginx before obtaining a certificate:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d files.example.com
curl -fsS https://files.example.com/health/ready
```

Set `client_max_body_size` to at least the largest upload accepted by the file
server. If a CDN or another proxy is in front of Nginx, its upload and request
timeout limits also apply.

## Persistence

The Compose package creates three named volumes:

- `fileserver-data` for SQLite metadata and administrator/client records
- `fileserver-storage` for stored binaries
- `fileserver-quarantine` for uploads undergoing validation

Container recreation preserves these volumes. Never run `docker compose down
-v` unless the intention is to permanently remove all file-server data.

Back up all three volumes as one consistent set. Stop writes (preferably stop
the container) while taking the backup, and verify restoration regularly. A
database backup without the matching binary-storage volume is incomplete.

Each database records its schema migration version. A new image applies missing
migrations during startup. An older image refuses to open a database written by
a newer schema version instead of attempting an unsafe downgrade.

## Network exposure

The deployment binds to `127.0.0.1` by default. Keep that default when a reverse
proxy runs on the same host. For remote access, terminate HTTPS at the reverse
proxy and forward requests to port 3000. Do not expose an unencrypted admin
console or service credentials over the public internet.

Change `FILESERVER_BIND_ADDRESS` only when the network boundary is understood,
for example when the reverse proxy runs on another trusted container network.

## Stop without deleting data

```powershell
docker compose --env-file deploy\.env -f deploy\compose.yaml down
```

The named volumes remain available for the next start.

## Upgrade and rollback

1. Read the target release notes and back up all persistent volumes.
2. Run `./update-fileserver.sh VERSION`; it verifies the deployment kit, updates
   `FILESERVER_VERSION`, installs the current Compose file, pulls the image, and
   waits for health.
3. Verify `/health/ready`, the administrator console, and one application
   upload/download flow.

An older image refuses to open metadata created by a newer schema. Rollback
therefore requires restoring the matching pre-upgrade volume backup as well as
the older image version.
