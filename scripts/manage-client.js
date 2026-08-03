const { closeDb, initializeDb } = require("../src/db/sqlite");
const {
  getPublicClients,
  provisionClient,
  rotateClient,
  setClientActive,
  updateClient,
} = require("../src/services/service-client.service");

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function run() {
  const action = process.argv[2];
  await initializeDb();

  if (action === "create") {
    output(
      await provisionClient({
        clientId: option("client-id"),
        displayName: option("name"),
        tenants: option("tenants"),
        permissions: option("permissions"),
      }),
    );
    return;
  }
  if (action === "rotate") {
    output(await rotateClient(option("client-id")));
    return;
  }
  if (action === "update") {
    output(
      await updateClient({
        clientId: option("client-id"),
        displayName: option("name"),
        tenants: option("tenants"),
        permissions: option("permissions"),
      }),
    );
    return;
  }
  if (action === "enable" || action === "disable") {
    output(
      await setClientActive(option("client-id"), action === "enable"),
    );
    return;
  }
  if (action === "list") {
    output(await getPublicClients());
    return;
  }

  throw new Error("Use create, update, rotate, enable, disable, or list");
}

run()
  .catch((error) => {
    process.stderr.write(
      `${JSON.stringify({ error: error.code || "CLIENT_COMMAND_FAILED", message: error.message })}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => closeDb());
