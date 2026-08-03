const assert = require("node:assert/strict");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const runtimeRoot = fsSync.mkdtempSync(
  path.join(os.tmpdir(), "upload-route-security-"),
);
process.env.NODE_ENV = "test";
process.env.FILESERVER_TOKEN_SIGNING_SECRET =
  "http-test-fileserver-signing-secret-with-at-least-32-characters";
process.env.FILESERVER_DATA_ROOT = path.join(runtimeRoot, "data");
process.env.FILESERVER_STORAGE_ROOT = path.join(runtimeRoot, "storage");
process.env.FILESERVER_DB_PATH = path.join(runtimeRoot, "data", "test.sqlite");
process.env.FILESERVER_QUARANTINE_ROOT = path.join(runtimeRoot, "quarantine");

const { createApp } = require("../src/app");
const { closeDb, initializeDb } = require("../src/db/sqlite");
const {
  provisionClient,
  rotateClient,
  setClientActive,
  updateClient,
} = require("../src/services/service-client.service");

let server;
let baseUrl;
let token;
let tokenResponse;
let wrongTenantToken;
let missingRoleToken;
let mainClientSecret;

async function requestToken(clientId, clientSecret) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${baseUrl}/auth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  return { response, body: await response.json() };
}

test.before(async () => {
  await initializeDb();
  const mainClient = await provisionClient({
    clientId: "baharsoft-demo-api",
    displayName: "Baharsoft Demo API",
    tenants: ["baharsoft-demo"],
    permissions: ["upload", "read", "delete", "restore"],
  });
  mainClientSecret = mainClient.clientSecret;
  const wrongTenantClient = await provisionClient({
    clientId: "another-tenant-api",
    tenants: ["another-tenant"],
    permissions: ["read"],
  });
  const missingRoleClient = await provisionClient({
    clientId: "upload-only-api",
    tenants: ["baharsoft-demo"],
    permissions: ["upload"],
  });

  const app = createApp({ readinessCheck: async () => true });
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  tokenResponse = await requestToken(
    mainClient.client.clientId,
    mainClient.clientSecret,
  );
  token = tokenResponse.body.access_token;
  wrongTenantToken = (
    await requestToken(
      wrongTenantClient.client.clientId,
      wrongTenantClient.clientSecret,
    )
  ).body.access_token;
  missingRoleToken = (
    await requestToken(
      missingRoleClient.client.clientId,
      missingRoleClient.clientSecret,
    )
  ).body.access_token;
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await closeDb();
  await fs.rm(runtimeRoot, { recursive: true, force: true });
});

function textUpload(name, content) {
  const form = new FormData();
  form.append("file", new Blob([content], { type: "text/plain" }), name);
  return form;
}

function documentUpload(name, content, metadata) {
  const form = textUpload(name, content);
  form.append("metadata", JSON.stringify(metadata));
  return form;
}

test("service clients exchange credentials for a short-lived token", async () => {
  assert.equal(tokenResponse.response.status, 200);
  assert.equal(tokenResponse.body.token_type, "Bearer");
  assert.equal(tokenResponse.body.expires_in, 300);
  assert.match(tokenResponse.body.access_token, /^[^.]+\.[^.]+\.[^.]+$/);
  assert.equal(tokenResponse.response.headers.get("cache-control"), "no-store");

  const invalid = await requestToken("baharsoft-demo-api", "wrong-secret");
  assert.equal(invalid.response.status, 401);
  assert.deepEqual(invalid.body, { error: "INVALID_CLIENT" });
});

test("HTTP uploads validate in quarantine and publish only after acceptance", async () => {
  const response = await fetch(
    `${baseUrl}/files/upload/baharsoft-demo/cases/identity`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: textUpload("passport.txt", "passport-content"),
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    await fs.readdir(process.env.FILESERVER_QUARANTINE_ROOT),
    [],
  );
  assert.equal(
    await fs.readFile(
      path.join(
        process.env.FILESERVER_STORAGE_ROOT,
        "baharsoft-demo",
        "cases",
        "identity",
        "passport.txt",
      ),
      "utf8",
    ),
    "passport-content",
  );
});

test("public documents are readable by documentId without service authentication", async () => {
  const uploadResponse = await fetch(
    `${baseUrl}/files/upload/baharsoft-demo/public-assets?visibility=public`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: textUpload("public-notice.txt", "public-content"),
    },
  );
  const uploaded = await uploadResponse.json();
  assert.equal(uploadResponse.status, 200);

  const readResponse = await fetch(`${baseUrl}${uploaded.file.url}`);
  assert.equal(readResponse.status, 200);
  assert.equal(await readResponse.text(), "public-content");
});

test("HTTP uploads reject encoded folder traversal before writing a body", async () => {
  const response = await fetch(
    `${baseUrl}/files/upload/baharsoft-demo/cases/%2e%2e%2foutside`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: textUpload("passport.txt", "unsafe-content"),
    },
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, "INVALID_FOLDER");
  assert.deepEqual(
    await fs.readdir(process.env.FILESERVER_QUARANTINE_ROOT),
    [],
  );
});

test("HTTP authorization rejects forged tokens, wrong tenants, and missing permissions", async () => {
  const audienceResponse = await fetch(
    `${baseUrl}/files/list/baharsoft-demo`,
    { headers: { Authorization: "Bearer forged.token.value" } },
  );
  assert.equal(audienceResponse.status, 401);
  assert.deepEqual(await audienceResponse.json(), { error: "INVALID_TOKEN" });

  const tenantResponse = await fetch(
    `${baseUrl}/files/list/baharsoft-demo`,
    { headers: { Authorization: `Bearer ${wrongTenantToken}` } },
  );
  assert.equal(tenantResponse.status, 403);
  assert.deepEqual(await tenantResponse.json(), {
    error: "TENANT_ACCESS_DENIED",
  });

  const roleResponse = await fetch(
    `${baseUrl}/files/list/baharsoft-demo`,
    { headers: { Authorization: `Bearer ${missingRoleToken}` } },
  );
  assert.equal(roleResponse.status, 403);
  assert.deepEqual(await roleResponse.json(), {
    error: "INSUFFICIENT_PERMISSION",
  });
});

test("HTTP document metadata can be uploaded, filtered, deleted, and restored", async () => {
  const uploadResponse = await fetch(
    `${baseUrl}/files/upload/baharsoft-demo/cases/identity`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: documentUpload("translated-passport.txt", "translated", {
        tags: [
          { key: "documentType", value: "passport" },
          { key: "origin", value: "translation" },
        ],
      }),
    },
  );
  const uploaded = await uploadResponse.json();

  assert.equal(uploadResponse.status, 200);
  assert.match(uploaded.file.documentId, /^[0-9a-f-]{36}$/);
  assert.match(uploaded.file.checksumSha256, /^[0-9a-f]{64}$/);
  assert.equal(
    uploaded.file.url,
    `/files/document/baharsoft-demo/${uploaded.file.documentId}`,
  );

  const unauthenticatedDownload = await fetch(`${baseUrl}${uploaded.file.url}`);
  assert.equal(unauthenticatedDownload.status, 401);

  const downloadResponse = await fetch(`${baseUrl}${uploaded.file.url}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(downloadResponse.status, 200);
  assert.equal(await downloadResponse.text(), "translated");

  const listResponse = await fetch(
    `${baseUrl}/files/list/baharsoft-demo?tag=documentType:passport&tag=origin:translation`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const listed = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].documentId, uploaded.file.documentId);

  const deleteResponse = await fetch(
    `${baseUrl}/files/baharsoft-demo/${uploaded.file.documentId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  assert.equal(deleteResponse.status, 204);

  const restoreResponse = await fetch(
    `${baseUrl}/files/baharsoft-demo/${uploaded.file.documentId}/restore`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const restored = await restoreResponse.json();
  assert.equal(restoreResponse.status, 200);
  assert.equal(restored.documentId, uploaded.file.documentId);
  assert.equal(restored.restored, true);
});

test("credential rotation and disabling revoke issued tokens", async () => {
  await updateClient({
    clientId: "baharsoft-demo-api",
    tenants: ["baharsoft-demo"],
    permissions: ["read"],
  });
  const grantChangedResponse = await fetch(
    `${baseUrl}/files/list/baharsoft-demo`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  assert.equal(grantChangedResponse.status, 401);

  const updatedGrantToken = await requestToken(
    "baharsoft-demo-api",
    mainClientSecret,
  );
  assert.equal(updatedGrantToken.response.status, 200);

  const rotated = await rotateClient("baharsoft-demo-api");

  const oldTokenResponse = await fetch(
    `${baseUrl}/files/list/baharsoft-demo`,
    {
      headers: {
        Authorization: `Bearer ${updatedGrantToken.body.access_token}`,
      },
    },
  );
  assert.equal(oldTokenResponse.status, 401);

  const replacement = await requestToken(
    rotated.client.clientId,
    rotated.clientSecret,
  );
  assert.equal(replacement.response.status, 200);

  await setClientActive("baharsoft-demo-api", false);
  const disabledResponse = await fetch(
    `${baseUrl}/files/list/baharsoft-demo`,
    {
      headers: {
        Authorization: `Bearer ${replacement.body.access_token}`,
      },
    },
  );
  assert.equal(disabledResponse.status, 401);
});
