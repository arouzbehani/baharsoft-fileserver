const { all, get, getDb, run, withTransaction } = require("../db/sqlite");

function mapClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.client_id,
    displayName: row.display_name,
    secretSalt: row.secret_salt,
    secretHash: row.secret_hash,
    tokenVersion: row.token_version,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tenants: [],
    permissions: [],
  };
}

async function attachGrants(clients, db = getDb()) {
  const present = clients.filter(Boolean);
  if (!present.length) return clients;

  const placeholders = present.map(() => "?").join(", ");
  const ids = present.map((client) => client.id);
  const [tenantRows, permissionRows] = await Promise.all([
    all(
      db,
      `SELECT service_client_id, tenant
       FROM service_client_tenants
       WHERE service_client_id IN (${placeholders})
       ORDER BY tenant`,
      ids,
    ),
    all(
      db,
      `SELECT service_client_id, permission
       FROM service_client_permissions
       WHERE service_client_id IN (${placeholders})
       ORDER BY permission`,
      ids,
    ),
  ]);

  const byId = new Map(present.map((client) => [client.id, client]));
  tenantRows.forEach((row) => byId.get(row.service_client_id).tenants.push(row.tenant));
  permissionRows.forEach((row) =>
    byId.get(row.service_client_id).permissions.push(row.permission),
  );
  return clients;
}

async function getServiceClientByClientId(clientId, db = getDb()) {
  const row = await get(
    db,
    "SELECT * FROM service_clients WHERE client_id = ? LIMIT 1",
    [clientId],
  );
  const client = mapClient(row);
  await attachGrants([client], db);
  return client;
}

async function createServiceClient({
  clientId,
  displayName,
  secretSalt,
  secretHash,
  tenants,
  permissions,
  createdAt,
}) {
  return withTransaction(async (db) => {
    const result = await run(
      db,
      `INSERT INTO service_clients (
        client_id, display_name, secret_salt, secret_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [clientId, displayName, secretSalt, secretHash, createdAt, createdAt],
    );

    for (const tenant of tenants) {
      await run(
        db,
        "INSERT INTO service_client_tenants (service_client_id, tenant) VALUES (?, ?)",
        [result.lastID, tenant],
      );
    }
    for (const permission of permissions) {
      await run(
        db,
        `INSERT INTO service_client_permissions
          (service_client_id, permission) VALUES (?, ?)`,
        [result.lastID, permission],
      );
    }

    return getServiceClientByClientId(clientId, db);
  });
}

async function rotateServiceClientSecret({
  clientId,
  secretSalt,
  secretHash,
  updatedAt,
}) {
  const db = getDb();
  return run(
    db,
    `UPDATE service_clients
     SET secret_salt = ?, secret_hash = ?, token_version = token_version + 1,
         updated_at = ?
     WHERE client_id = ?`,
    [secretSalt, secretHash, updatedAt, clientId],
  );
}

async function updateServiceClientGrants({
  clientId,
  displayName,
  tenants,
  permissions,
  updatedAt,
}) {
  return withTransaction(async (db) => {
    const client = await getServiceClientByClientId(clientId, db);
    if (!client) return null;

    await run(
      db,
      `UPDATE service_clients
       SET display_name = ?, token_version = token_version + 1, updated_at = ?
       WHERE id = ?`,
      [displayName, updatedAt, client.id],
    );
    await run(
      db,
      "DELETE FROM service_client_tenants WHERE service_client_id = ?",
      [client.id],
    );
    await run(
      db,
      "DELETE FROM service_client_permissions WHERE service_client_id = ?",
      [client.id],
    );
    for (const tenant of tenants) {
      await run(
        db,
        "INSERT INTO service_client_tenants (service_client_id, tenant) VALUES (?, ?)",
        [client.id, tenant],
      );
    }
    for (const permission of permissions) {
      await run(
        db,
        `INSERT INTO service_client_permissions
          (service_client_id, permission) VALUES (?, ?)`,
        [client.id, permission],
      );
    }
    return getServiceClientByClientId(clientId, db);
  });
}

async function setServiceClientActive({ clientId, active, updatedAt }) {
  const db = getDb();
  return run(
    db,
    `UPDATE service_clients
     SET active = ?, token_version = token_version + 1, updated_at = ?
     WHERE client_id = ? AND active <> ?`,
    [active ? 1 : 0, updatedAt, clientId, active ? 1 : 0],
  );
}

async function listServiceClients() {
  const db = getDb();
  const rows = await all(db, "SELECT * FROM service_clients ORDER BY client_id");
  const clients = rows.map(mapClient);
  await attachGrants(clients, db);
  return clients;
}

module.exports = {
  createServiceClient,
  getServiceClientByClientId,
  listServiceClients,
  rotateServiceClientSecret,
  setServiceClientActive,
  updateServiceClientGrants,
};
