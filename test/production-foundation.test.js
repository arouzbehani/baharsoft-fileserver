const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");
const { getRuntimeConfig } = require("../src/config/env");

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    PORT: "8080",
    FILESERVER_TOKEN_SIGNING_SECRET:
      "a-fileserver-only-signing-secret-with-at-least-32-characters",
    FILESERVER_ADMIN_BOOTSTRAP_TOKEN:
      "a-one-time-admin-bootstrap-token-with-at-least-32-characters",
    FILESERVER_DATA_ROOT: "./runtime-data",
    FILESERVER_STORAGE_ROOT: "./runtime-storage",
    ...overrides,
  };
}

async function withServer(app, callback) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("runtime configuration validates and resolves production settings", () => {
  const config = getRuntimeConfig(productionEnv());

  assert.equal(config.nodeEnv, "production");
  assert.equal(config.serviceVersion, "1.0.2");
  assert.equal(config.port, 8080);
  assert.match(config.dataRoot, /runtime-data$/);
  assert.match(config.storageRoot, /runtime-storage$/);
  assert.equal(config.tokenAudience, "baharsoft-fileserver");
  assert.equal(config.tokenTtlSeconds, 300);
  assert.equal(config.adminSessionTtlSeconds, 28800);
  assert.equal(config.adminPath, "/admin");
  assert.equal(
    config.adminBootstrapToken,
    "a-one-time-admin-bootstrap-token-with-at-least-32-characters",
  );
});

test("runtime configuration validates a custom administrator path", () => {
  assert.equal(
    getRuntimeConfig(productionEnv({ FILESERVER_ADMIN_PATH: "/control-7d9f31a84c" })).adminPath,
    "/control-7d9f31a84c",
  );

  for (const adminPath of [
    "admin",
    "/ab",
    "/admin/extra",
    "/admin-api",
    "/files",
    "/admin?key=value",
  ]) {
    assert.throws(
      () => getRuntimeConfig(productionEnv({ FILESERVER_ADMIN_PATH: adminPath })),
      /FILESERVER_ADMIN_PATH/,
    );
  }
});

test("runtime configuration requires secure internal token settings", () => {
  assert.throws(
    () =>
      getRuntimeConfig(
        productionEnv({ FILESERVER_TOKEN_SIGNING_SECRET: "short" }),
      ),
    /at least 32 characters/,
  );
  assert.throws(
    () =>
      getRuntimeConfig(
        productionEnv({ FILESERVER_TOKEN_TTL_SECONDS: "3601" }),
      ),
    /must not exceed 3600 seconds/,
  );
  assert.throws(
    () =>
      getRuntimeConfig(
        productionEnv({ FILESERVER_ADMIN_BOOTSTRAP_TOKEN: "" }),
      ),
    /required in production/,
  );
});

test("runtime configuration keeps quarantine outside final storage", () => {
  assert.throws(
    () =>
      getRuntimeConfig(productionEnv({
        FILESERVER_STORAGE_ROOT: "./runtime-storage",
        FILESERVER_QUARANTINE_ROOT: "./runtime-storage/quarantine",
      })),
    /operationally separate/,
  );
});

test("liveness and readiness endpoints report healthy state", async () => {
  const app = createApp({ readinessCheck: async () => true });

  await withServer(app, async (baseUrl) => {
    const liveResponse = await fetch(`${baseUrl}/health/live`);
    const readyResponse = await fetch(`${baseUrl}/health/ready`);

    assert.equal(liveResponse.status, 200);
    assert.deepEqual(await liveResponse.json(), {
      status: "ok",
      version: "1.0.2",
    });
    assert.equal(readyResponse.status, 200);
    assert.deepEqual(await readyResponse.json(), {
      status: "ok",
      version: "1.0.2",
    });
  });
});

test("readiness endpoint returns 503 when its dependency is unavailable", async () => {
  const app = createApp({ readinessCheck: async () => false });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health/ready`);

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      status: "unavailable",
      error: "SERVICE_NOT_READY",
    });
  });
});
