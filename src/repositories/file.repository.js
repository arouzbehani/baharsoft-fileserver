const {
  getDb,
  run,
  get,
  all,
  withTransaction,
} = require("../db/sqlite");

function deriveStatus(row) {
  if (row.purged_at) return "purged";
  if (row.deleted_at) return "deleted";
  return "active";
}

function mapRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    publicId: row.public_id,
    tenant: row.tenant,
    folder: row.folder,
    originalName: row.original_name,
    storedName: row.stored_name,
    relativePath: row.relative_path,
    visibility: row.visibility,
    mimeType: row.mime_type,
    declaredMimeType: row.declared_mime_type,
    detectedMimeType: row.detected_mime_type,
    fileExtension: row.file_extension,
    size: row.size,
    uploadedAt: row.uploaded_at,
    uploadedBy: row.uploaded_by,
    checksumSha256: row.checksum_sha256,
    deletedAt: row.deleted_at,
    purgedAt: row.purged_at,
    status: deriveStatus(row),
    tags: [],
  };
}

async function listTagsForFileIds(fileIds, db = getDb()) {
  if (!fileIds.length) return new Map();

  const placeholders = fileIds.map(() => "?").join(", ");
  const rows = await all(
    db,
    `
    SELECT file_id, tag_key, tag_value
    FROM file_tags
    WHERE file_id IN (${placeholders})
    ORDER BY tag_key ASC, tag_value ASC
    `,
    fileIds,
  );
  const tagsByFileId = new Map();

  for (const row of rows) {
    const tags = tagsByFileId.get(row.file_id) || [];
    tags.push({ key: row.tag_key, value: row.tag_value });
    tagsByFileId.set(row.file_id, tags);
  }

  return tagsByFileId;
}

async function attachTags(files, db = getDb()) {
  const presentFiles = files.filter(Boolean);
  const tagsByFileId = await listTagsForFileIds(
    presentFiles.map((file) => file.id),
    db,
  );

  for (const file of presentFiles) {
    file.tags = tagsByFileId.get(file.id) || [];
  }

  return files;
}

async function replaceTags(fileId, tags, db = getDb()) {
  await run(db, "DELETE FROM file_tags WHERE file_id = ?", [fileId]);

  for (const tag of tags) {
    await run(
      db,
      `INSERT INTO file_tags (file_id, tag_key, tag_value) VALUES (?, ?, ?)`,
      [fileId, tag.key, tag.value],
    );
  }
}
async function listPurgeCandidates({ tenant, limit, deletedBefore }) {
  const db = getDb();

  const rows = await all(
    db,
    `
    SELECT *
    FROM files
    WHERE tenant = ?
      AND deleted_at IS NOT NULL
      AND purged_at IS NULL
      AND deleted_at <= ?
    ORDER BY deleted_at ASC, id ASC
    LIMIT ?
    `,
    [tenant, deletedBefore, limit],
  );

  return rows.map(mapRow);
}
async function markPurgedById(id, purgedAt) {
  const db = getDb();

  return run(
    db,
    `
    UPDATE files
    SET purged_at = ?
    WHERE id = ?
      AND deleted_at IS NOT NULL
      AND purged_at IS NULL
    `,
    [purgedAt, id],
  );
}
async function getByTenantAndRelativePath(
  tenant,
  relativePath,
  db = getDb(),
) {
  const row = await get(
    db,
    `
    SELECT *
    FROM files
    WHERE tenant = ? AND relative_path = ? AND deleted_at IS NULL
    LIMIT 1
    `,
    [tenant, relativePath],
  );

  const file = mapRow(row);
  await attachTags([file], db);
  return file;
}
function identifierColumn(identifier) {
  return typeof identifier === "number" ? "id" : "public_id";
}

async function getActiveByTenantAndIdentifier(tenant, identifier) {
  const db = getDb();
  const column = identifierColumn(identifier);

  const row = await get(
    db,
    `
    SELECT *
    FROM files
    WHERE tenant = ? AND ${column} = ? AND deleted_at IS NULL
    LIMIT 1
    `,
    [tenant, identifier],
  );

  const file = mapRow(row);
  await attachTags([file], db);
  return file;
}

async function softDeleteByTenantAndIdentifier(
  tenant,
  identifier,
  deletedAt,
) {
  const db = getDb();
  const column = identifierColumn(identifier);

  return run(
    db,
    `
    UPDATE files
    SET deleted_at = ?
    WHERE tenant = ? AND ${column} = ? AND deleted_at IS NULL
    `,
    [deletedAt, tenant, identifier],
  );
}
async function insertFile(file, db = getDb()) {
  const result = await run(
    db,
    `
    INSERT INTO files (
      public_id,
      tenant,
      folder,
      original_name,
      stored_name,
      relative_path,
      visibility,
      mime_type,
      declared_mime_type,
      detected_mime_type,
      file_extension,
      size,
      uploaded_at,
      uploaded_by,
      checksum_sha256
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      file.publicId,
      file.tenant,
      file.folder,
      file.originalName,
      file.storedName,
      file.relativePath,
      file.visibility,
      file.mimeType,
      file.declaredMimeType || null,
      file.detectedMimeType || null,
      file.fileExtension || null,
      file.size,
      file.uploadedAt,
      file.uploadedBy,
      file.checksumSha256,
    ],
  );

  return {
    id: result.lastID,
    ...file,
    status: "active",
    tags: [],
  };
}

async function updateByTenantAndRelativePath(
  tenant,
  relativePath,
  file,
  db = getDb(),
) {
  await run(
    db,
    `
    UPDATE files
    SET
      folder = ?,
      original_name = ?,
      stored_name = ?,
      visibility = ?,
      mime_type = ?,
      declared_mime_type = ?,
      detected_mime_type = ?,
      file_extension = ?,
      size = ?,
      uploaded_at = ?,
      uploaded_by = ?,
      checksum_sha256 = ?
    WHERE tenant = ? AND relative_path = ? AND deleted_at IS NULL
    `,
    [
      file.folder,
      file.originalName,
      file.storedName,
      file.visibility,
      file.mimeType,
      file.declaredMimeType || null,
      file.detectedMimeType || null,
      file.fileExtension || null,
      file.size,
      file.uploadedAt,
      file.uploadedBy,
      file.checksumSha256,
      tenant,
      relativePath,
    ],
  );

  return getByTenantAndRelativePath(tenant, relativePath, db);
}
async function getAnyByTenantAndRelativePath(
  tenant,
  relativePath,
  db = getDb(),
) {
  const row = await get(
    db,
    `
    SELECT *
    FROM files
    WHERE tenant = ? AND relative_path = ?
    LIMIT 1
    `,
    [tenant, relativePath],
  );

  const file = mapRow(row);
  await attachTags([file], db);
  return file;
}

async function reviveByTenantAndRelativePath(
  tenant,
  relativePath,
  file,
  db = getDb(),
) {
  await run(
    db,
    `
    UPDATE files
    SET
      folder = ?,
      original_name = ?,
      stored_name = ?,
      visibility = ?,
      mime_type = ?,
      declared_mime_type = ?,
      detected_mime_type = ?,
      file_extension = ?,
      size = ?,
      uploaded_at = ?,
      uploaded_by = ?,
      checksum_sha256 = ?,
      deleted_at = NULL,
      purged_at = NULL
    WHERE tenant = ? AND relative_path = ?
    `,
    [
      file.folder,
      file.originalName,
      file.storedName,
      file.visibility,
      file.mimeType,
      file.declaredMimeType || null,
      file.detectedMimeType || null,
      file.fileExtension || null,
      file.size,
      file.uploadedAt,
      file.uploadedBy,
      file.checksumSha256,
      tenant,
      relativePath,
    ],
  );

  return getByTenantAndRelativePath(tenant, relativePath, db);
}

async function saveFileMetadata({ file, replaceFileTags, tags }) {
  return withTransaction(async (db) => {
    const existingActive = await getByTenantAndRelativePath(
      file.tenant,
      file.relativePath,
      db,
    );
    const existingAny = existingActive
      ? existingActive
      : await getAnyByTenantAndRelativePath(
          file.tenant,
          file.relativePath,
          db,
        );
    let saved;

    if (existingActive) {
      saved = await updateByTenantAndRelativePath(
        file.tenant,
        file.relativePath,
        file,
        db,
      );
    } else if (existingAny) {
      saved = await reviveByTenantAndRelativePath(
        file.tenant,
        file.relativePath,
        file,
        db,
      );
    } else {
      saved = await insertFile(file, db);
    }

    if (replaceFileTags) {
      await replaceTags(saved.id, tags, db);
    }

    await attachTags([saved], db);
    return saved;
  });
}

async function listFiles({
  tenant,
  folder,
  visibility,
  tags = [],
  limit,
  cursor,
}) {
  const db = getDb();

  const params = [];
  const where = ["tenant = ?", "deleted_at IS NULL"];
  params.push(tenant);

  if (folder) {
    where.push("folder = ?");
    params.push(folder);
  }

  if (visibility) {
    where.push("visibility = ?");
    params.push(visibility);
  }

  for (const tag of tags) {
    where.push(`
      EXISTS (
        SELECT 1
        FROM file_tags
        WHERE file_tags.file_id = files.id
          AND file_tags.tag_key = ?
          AND file_tags.tag_value = ?
      )
    `);
    params.push(tag.key, tag.value);
  }

  // Cursor: uploaded_at DESC, id DESC
  if (cursor) {
    where.push(`
      (
        uploaded_at < ?
        OR (uploaded_at = ? AND id < ?)
      )
    `);
    params.push(cursor.uploadedAt, cursor.uploadedAt, cursor.id);
  }

  const sql = `
    SELECT *
    FROM files
    WHERE ${where.join(" AND ")}
    ORDER BY uploaded_at DESC, id DESC
    LIMIT ?
  `;

  params.push(limit + 1); // for hasMore detection

  const rows = await all(db, sql, params);

  const files = rows.map(mapRow);
  await attachTags(files, db);
  return files;
}

async function listKnownTenants() {
  const rows = await all(
    getDb(),
    `SELECT tenant FROM files
     UNION
     SELECT tenant FROM service_client_tenants
     ORDER BY tenant`,
  );
  return rows.map((row) => row.tenant);
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, "\\$&");
}

async function listFilesForAdmin({
  tenant,
  folder,
  visibility,
  status,
  search,
  tags = [],
  limit,
  cursor,
}) {
  const db = getDb();
  const params = [tenant];
  const where = ["tenant = ?"];

  if (folder) {
    where.push("folder = ?");
    params.push(folder);
  }
  if (visibility) {
    where.push("visibility = ?");
    params.push(visibility);
  }
  if (status === "active") where.push("deleted_at IS NULL");
  if (status === "deleted") {
    where.push("deleted_at IS NOT NULL AND purged_at IS NULL");
  }
  if (status === "purged") where.push("purged_at IS NOT NULL");

  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    where.push(`(
      original_name LIKE ? ESCAPE '\\'
      OR stored_name LIKE ? ESCAPE '\\'
      OR public_id LIKE ? ESCAPE '\\'
    )`);
    params.push(pattern, pattern, pattern);
  }

  for (const tag of tags) {
    where.push(`EXISTS (
      SELECT 1 FROM file_tags
      WHERE file_tags.file_id = files.id
        AND file_tags.tag_key = ?
        AND file_tags.tag_value = ?
    )`);
    params.push(tag.key, tag.value);
  }

  if (cursor) {
    where.push("(uploaded_at < ? OR (uploaded_at = ? AND id < ?))");
    params.push(cursor.uploadedAt, cursor.uploadedAt, cursor.id);
  }

  params.push(limit + 1);
  const rows = await all(
    db,
    `SELECT * FROM files
     WHERE ${where.join(" AND ")}
     ORDER BY uploaded_at DESC, id DESC
     LIMIT ?`,
    params,
  );
  const files = rows.map(mapRow);
  await attachTags(files, db);
  return files;
}
async function getDeletedByTenantAndIdentifier(tenant, identifier) {
  const db = getDb();
  const column = identifierColumn(identifier);

  const row = await get(
    db,
    `
    SELECT *
    FROM files
    WHERE tenant = ?
      AND ${column} = ?
      AND deleted_at IS NOT NULL
    LIMIT 1
    `,
    [tenant, identifier],
  );

  const file = mapRow(row);
  await attachTags([file], db);
  return file;
}

async function restoreByTenantAndIdentifier(tenant, identifier) {
  const db = getDb();
  const column = identifierColumn(identifier);

  return run(
    db,
    `
    UPDATE files
    SET deleted_at = NULL
    WHERE tenant = ?
      AND ${column} = ?
      AND deleted_at IS NOT NULL
      AND purged_at IS NULL
    `,
    [tenant, identifier],
  );
}
module.exports = {
  getByTenantAndRelativePath,
  getAnyByTenantAndRelativePath,
  getActiveByTenantAndIdentifier,
  softDeleteByTenantAndIdentifier,
  insertFile,
  updateByTenantAndRelativePath,
  reviveByTenantAndRelativePath,
  saveFileMetadata,
  listFiles,
  listFilesForAdmin,
  listKnownTenants,
  listPurgeCandidates,
  markPurgedById,
  getDeletedByTenantAndIdentifier,
  restoreByTenantAndIdentifier,
};
