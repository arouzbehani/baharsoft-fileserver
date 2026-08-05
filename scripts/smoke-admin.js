const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runtimeRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "baharsoft-fileserver-admin-smoke-"),
);
process.env.NODE_ENV = "test";
process.env.FILESERVER_TOKEN_SIGNING_SECRET =
  "admin-smoke-test-signing-secret-longer-than-thirty-two";
process.env.FILESERVER_DATA_ROOT = path.join(runtimeRoot, "data");
process.env.FILESERVER_DB_PATH = path.join(runtimeRoot, "data", "fileserver.sqlite");
process.env.FILESERVER_QUARANTINE_ROOT = path.join(runtimeRoot, "quarantine");
process.env.FILESERVER_STORAGE_ROOT = path.join(runtimeRoot, "storage", "tenants");
process.env.FILESERVER_ADMIN_PATH = "/control-admin-smoke";

async function main() {
  const adminDist = path.resolve(__dirname, "../admin-ui/dist");
  if (!fs.existsSync(path.join(adminDist, "index.html"))) {
    throw new Error("Admin UI is not built. Run npm run admin:build first.");
  }

  const { createApp } = require("../src/app");
  const { getRuntimeConfig } = require("../src/config/env");
  const { closeDb, initializeDb } = require("../src/db/sqlite");
  await initializeDb();
  const { adminPath } = getRuntimeConfig();
  const server = createApp({ adminPath }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const page = await fetch(`${baseUrl}${adminPath}/`);
    if (!page.ok) throw new Error(`Admin page returned HTTP ${page.status}`);
    const html = await page.text();
    const assetPath = /src="([^"]+\.js)"/.exec(html)?.[1];
    if (!assetPath) throw new Error("Admin page does not reference its JavaScript bundle");
    const asset = await fetch(new URL(assetPath, `${baseUrl}${adminPath}/`));
    if (!asset.ok) throw new Error(`Admin JavaScript returned HTTP ${asset.status}`);
    const setup = await fetch(`${baseUrl}${adminPath}/api/setup/status`);
    if (!setup.ok) throw new Error(`Admin API returned HTTP ${setup.status}`);
    const oldAdmin = await fetch(`${baseUrl}/admin/`);
    const oldAdminApi = await fetch(`${baseUrl}/admin-api/setup/status`);
    if (oldAdmin.status !== 404 || oldAdminApi.status !== 404) {
      throw new Error("Legacy admin routes remain exposed with a custom admin path");
    }
    console.log("Admin page, JavaScript bundle, and setup API are available.");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await closeDb();
  }
}

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    if (error.cause) console.error(error.cause);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  });
