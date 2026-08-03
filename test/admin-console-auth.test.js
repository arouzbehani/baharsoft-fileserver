const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fileserver-admin-test-"));
process.env.NODE_ENV = "test";
process.env.FILESERVER_TOKEN_SIGNING_SECRET =
  "admin-console-test-signing-secret-longer-than-thirty-two";
process.env.FILESERVER_ADMIN_BOOTSTRAP_TOKEN =
  "admin-console-test-bootstrap-token-longer-than-thirty-two";
process.env.FILESERVER_DATA_ROOT = path.join(root, "data");
process.env.FILESERVER_DB_PATH = path.join(root, "data", "fileserver.sqlite");
process.env.FILESERVER_STORAGE_ROOT = path.join(root, "storage", "tenants");
process.env.FILESERVER_QUARANTINE_ROOT = path.join(root, "data", "quarantine");

const { createApp } = require("../src/app");
const { closeDb, initializeDb } = require("../src/db/sqlite");

let server;
let baseUrl;

test.before(async () => {
  await initializeDb();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});

test("first-run setup creates one admin and protects client management", async () => {
  const initial = await fetch(`${baseUrl}/admin-api/setup/status`);
  assert.deepEqual(await initial.json(), {
    setupRequired: true,
    bootstrapRequired: true,
  });

  const rejectedSetup = await fetch(`${baseUrl}/admin-api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "administrator",
      password: "a-secure-test-password",
      bootstrapToken: "incorrect-bootstrap-token-value",
    }),
  });
  assert.equal(rejectedSetup.status, 403);

  const setup = await fetch(`${baseUrl}/admin-api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "administrator",
      password: "a-secure-test-password",
      bootstrapToken: process.env.FILESERVER_ADMIN_BOOTSTRAP_TOKEN,
    }),
  });
  assert.equal(setup.status, 201);
  const setupBody = await setup.json();
  const cookie = setup.headers.get("set-cookie").split(";")[0];
  assert.equal(setupBody.admin.username, "administrator");
  assert.ok(setupBody.csrfToken);
  assert.equal(setup.headers.get("cache-control"), "no-store");

  const repeated = await fetch(`${baseUrl}/admin-api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "another-admin", password: "another-secure-password" }),
  });
  assert.equal(repeated.status, 409);

  const unauthenticated = await fetch(`${baseUrl}/admin-api/clients`);
  assert.equal(unauthenticated.status, 401);

  const withoutCsrf = await fetch(`${baseUrl}/admin-api/clients`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(withoutCsrf.status, 403);

  const created = await fetch(`${baseUrl}/admin-api/clients`, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      "x-admin-csrf": setupBody.csrfToken,
    },
    body: JSON.stringify({
      clientId: "baharsoft-demo-api",
      displayName: "Baharsoft Demo API",
      tenants: ["baharsoft-demo"],
      permissions: ["upload", "read"],
    }),
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.match(createdBody.clientSecret, /^fs_/);

  const listed = await fetch(`${baseUrl}/admin-api/clients`, {
    headers: { cookie },
  });
  assert.equal(listed.status, 200);
  const listedBody = await listed.json();
  assert.equal(listedBody.clients.length, 1);
  assert.equal(listedBody.clients[0].clientId, "baharsoft-demo-api");
  assert.equal("clientSecret" in listedBody.clients[0], false);

  const form = new FormData();
  form.append(
    "file",
    new Blob(["private passport content"], { type: "text/plain" }),
    "passport.txt",
  );
  form.append(
    "metadata",
    JSON.stringify({
      tags: [
        { key: "documentType", value: "passport" },
        { key: "origin", value: "original" },
      ],
    }),
  );
  const uploaded = await fetch(
    `${baseUrl}/admin-api/files/baharsoft-demo/upload/documents?visibility=private`,
    {
      method: "POST",
      headers: { cookie, "x-admin-csrf": setupBody.csrfToken },
      body: form,
    },
  );
  assert.equal(uploaded.status, 201);
  const uploadedBody = await uploaded.json();
  const documentId = uploadedBody.file.documentId;
  assert.match(documentId, /^[0-9a-f-]{36}$/);
  assert.equal(uploadedBody.file.uploadedBy, "admin:administrator");

  const tenants = await fetch(`${baseUrl}/admin-api/tenants`, {
    headers: { cookie },
  });
  assert.deepEqual(await tenants.json(), { tenants: ["baharsoft-demo"] });

  const files = await fetch(
    `${baseUrl}/admin-api/files/baharsoft-demo?search=passport&tag=documentType:passport`,
    { headers: { cookie } },
  );
  const filesBody = await files.json();
  assert.equal(files.status, 200);
  assert.equal(filesBody.items.length, 1);
  assert.equal(filesBody.items[0].documentId, documentId);

  const content = await fetch(
    `${baseUrl}/admin-api/files/baharsoft-demo/${documentId}/content`,
    { headers: { cookie } },
  );
  assert.equal(content.status, 200);
  assert.equal(await content.text(), "private passport content");

  const remove = () => fetch(
    `${baseUrl}/admin-api/files/baharsoft-demo/${documentId}`,
    {
      method: "DELETE",
      headers: { cookie, "x-admin-csrf": setupBody.csrfToken },
    },
  );
  assert.equal((await remove()).status, 200);

  const deleted = await fetch(
    `${baseUrl}/admin-api/files/baharsoft-demo?status=deleted`,
    { headers: { cookie } },
  );
  const deletedBody = await deleted.json();
  assert.equal(deletedBody.items.length, 1);
  assert.equal(deletedBody.items[0].status, "deleted");

  const restored = await fetch(
    `${baseUrl}/admin-api/files/baharsoft-demo/${documentId}/restore`,
    {
      method: "POST",
      headers: { cookie, "x-admin-csrf": setupBody.csrfToken },
    },
  );
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).restored, true);

  assert.equal((await remove()).status, 200);
  const purged = await fetch(
    `${baseUrl}/admin-api/files/baharsoft-demo/${documentId}/purge`,
    {
      method: "POST",
      headers: { cookie, "x-admin-csrf": setupBody.csrfToken },
    },
  );
  assert.equal(purged.status, 200);
  assert.equal((await purged.json()).purged, true);

  const logout = await fetch(`${baseUrl}/admin-api/logout`, {
    method: "POST",
    headers: { cookie, "x-admin-csrf": setupBody.csrfToken },
  });
  assert.equal(logout.status, 204);

  const expired = await fetch(`${baseUrl}/admin-api/session`, {
    headers: { cookie },
  });
  assert.equal(expired.status, 401);
});

test("existing administrator can log in", async () => {
  const response = await fetch(`${baseUrl}/admin-api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "administrator", password: "a-secure-test-password" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.admin.username, "administrator");
  assert.ok(response.headers.get("set-cookie").includes("HttpOnly"));
});
