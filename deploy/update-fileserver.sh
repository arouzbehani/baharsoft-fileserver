#!/usr/bin/env bash

set -Eeuo pipefail

readonly REPOSITORY="arouzbehani/baharsoft-fileserver"
readonly HEALTH_TIMEOUT_SECONDS="${FILESERVER_UPDATE_HEALTH_TIMEOUT_SECONDS:-180}"

usage() {
  printf 'Usage: %s VERSION\n' "$(basename "$0")"
  printf 'Example: %s 1.1.0\n' "$(basename "$0")"
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

if [[ $# -ne 1 ]]; then
  usage >&2
  exit 2
fi

readonly VERSION="$1"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
  fail "VERSION must be an exact stable version such as 1.1.0 (without a leading v)."
[[ "$HEALTH_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] ||
  fail "FILESERVER_UPDATE_HEALTH_TIMEOUT_SECONDS must be a positive integer."

for command_name in curl sha256sum tar awk docker install mktemp; do
  require_command "$command_name"
done
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required."

readonly SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly ENV_FILE="${SCRIPT_DIR}/.env"
readonly ARCHIVE="baharsoft-fileserver-${VERSION}-deploy.tar.gz"
readonly RELEASE_URL="https://github.com/${REPOSITORY}/releases/download/v${VERSION}"

[[ -f "$ENV_FILE" ]] ||
  fail "No .env file found in ${SCRIPT_DIR}. Configure .env before updating."

readonly TEMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf -- "$TEMP_DIR"
}
trap cleanup EXIT

printf 'Downloading Baharsoft File Server %s deployment kit...\n' "$VERSION"
curl --fail --location --show-error --silent --retry 3 \
  --output "${TEMP_DIR}/${ARCHIVE}" "${RELEASE_URL}/${ARCHIVE}"
curl --fail --location --show-error --silent --retry 3 \
  --output "${TEMP_DIR}/${ARCHIVE}.sha256" "${RELEASE_URL}/${ARCHIVE}.sha256"

read -r expected_hash expected_name < "${TEMP_DIR}/${ARCHIVE}.sha256" ||
  fail "Could not read the release checksum."
[[ "$expected_hash" =~ ^[[:xdigit:]]{64}$ ]] || fail "The release checksum is malformed."
expected_name="${expected_name#\*}"
[[ "$expected_name" == "$ARCHIVE" ]] || fail "The release checksum names an unexpected file."
(
  cd "$TEMP_DIR"
  printf '%s  %s\n' "$expected_hash" "$ARCHIVE" | sha256sum --check --status -
) || fail "Deployment kit checksum verification failed."

readonly KIT_DIR="${TEMP_DIR}/kit"
mkdir "$KIT_DIR"
tar -xzf "${TEMP_DIR}/${ARCHIVE}" -C "$KIT_DIR"
for kit_file in compose.yaml .env.example; do
  [[ -f "${KIT_DIR}/${kit_file}" ]] || fail "Deployment kit is missing ${kit_file}."
done

if [[ ! -f "${KIT_DIR}/update-fileserver.sh" ]]; then
  printf 'Release %s predates the bundled updater; keeping the installed updater.\n' "$VERSION"
fi

readonly NEXT_ENV="${TEMP_DIR}/.env"
awk -v version="$VERSION" '
  BEGIN { found = 0 }
  /^FILESERVER_VERSION=/ {
    print "FILESERVER_VERSION=" version
    found = 1
    next
  }
  { print }
  END {
    if (!found) print "FILESERVER_VERSION=" version
  }
' "$ENV_FILE" > "$NEXT_ENV"

printf 'Validating the %s deployment configuration...\n' "$VERSION"
docker compose --env-file "$NEXT_ENV" -f "${KIT_DIR}/compose.yaml" config --quiet

install -m 0644 "${KIT_DIR}/compose.yaml" "${SCRIPT_DIR}/compose.yaml"
install -m 0644 "${KIT_DIR}/.env.example" "${SCRIPT_DIR}/.env.example"
if [[ -f "${KIT_DIR}/update-fileserver.sh" ]]; then
  install -m 0755 "${KIT_DIR}/update-fileserver.sh" "${SCRIPT_DIR}/update-fileserver.sh"
fi
install -m 0600 "$NEXT_ENV" "$ENV_FILE"

printf 'Pulling Baharsoft File Server %s...\n' "$VERSION"
docker compose --env-file "$ENV_FILE" -f "${SCRIPT_DIR}/compose.yaml" pull fileserver

printf 'Starting the service and waiting up to %s seconds for health...\n' "$HEALTH_TIMEOUT_SECONDS"
docker compose --env-file "$ENV_FILE" -f "${SCRIPT_DIR}/compose.yaml" \
  up -d --wait --wait-timeout "$HEALTH_TIMEOUT_SECONDS" fileserver

printf 'Baharsoft File Server %s is healthy.\n' "$VERSION"
