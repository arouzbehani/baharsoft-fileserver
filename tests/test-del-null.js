// test-db.js
const { initializeDb, restoreFileById, getDb, get } = require("../src/db/sqlite");

async function main() {
  // Ensure DB structure & indices (including deleted_at column)
  await initializeDb();

  // The row ID you want to restore
  const id = 14; // change as needed

  // Set deleted_at = NULL for this id
  const result = await restoreFileById(id);
  console.log("Update result:", result); // { lastID, changes }

  // Optional: verify
  const db = getDb();
  const row = await get(db, "SELECT id, deleted_at FROM files WHERE id = ?", [id]);
  console.log("Row after update:", row);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
