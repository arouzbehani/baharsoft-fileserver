# Releasing Baharsoft File Server

Releases are created only from stable semantic-version tags on commits contained
in `main`. The tag must match the version in the root `package.json`.

## Prepare a release

1. Merge all intended changes into `main` and confirm CI is green.
2. Update the root package version and commit it through a pull request.
3. Pull the resulting `main` commit locally.
4. Create and push the matching tag.

For version `1.1.0`:

```powershell
npm version 1.1.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore: prepare release 1.1.0"
git push

# After that version commit is merged into main:
git tag v1.1.0
git push origin v1.1.0
```

The tag starts the release workflow. It reruns verification, builds Linux AMD64
and ARM64 images, and publishes the following GHCR tags:

```text
ghcr.io/arouzbehani/baharsoft-fileserver:1.1.0
ghcr.io/arouzbehani/baharsoft-fileserver:1.1
ghcr.io/arouzbehani/baharsoft-fileserver:1
ghcr.io/arouzbehani/baharsoft-fileserver:latest
```

The workflow also creates a GitHub Release containing a Compose deployment kit
and its SHA-256 checksum. The kit contains `compose.yaml`, `.env.example`, and
`update-fileserver.sh`. The workflow never connects to or deploys onto a server.

## Release safety

- Never move or reuse a published version tag.
- Never publish a tag before its version commit is merged into `main`.
- Back up persistent volumes before consumers install an update containing a
  database migration.
- A failed verification job publishes nothing.
- If publishing fails after uploading some image manifests, fix the workflow and
  rerun the same GitHub Actions job; do not create a different commit under the
  same version tag.
