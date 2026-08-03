# 📄 File Server Lifecycle Management (v1.0)

## Overview

This document describes the **file lifecycle management system** implemented in the multi-tenant file server.

The system follows a **metadata-first architecture**, where:

* SQLite is the **source of truth**
* Disk storage is **secondary**
* All operations are controlled via metadata

---

# 🧠 Lifecycle States

Each file can be in one of the following states:

| State        | `deleted_at` | `purged_at` | Description             |
| ------------ | ------------ | ----------- | ----------------------- |
| Active       | `NULL`       | `NULL`      | File is available       |
| Soft Deleted | NOT NULL     | `NULL`      | Hidden but recoverable  |
| Purged       | NOT NULL     | NOT NULL    | File removed from disk  |
| Revived      | `NULL`       | `NULL`      | Re-uploaded or restored |

---

# 🔄 Lifecycle Flow

```text
UPLOAD → ACTIVE
      ↓
DELETE → SOFT DELETED
      ↓
      ├── RESTORE → ACTIVE
      │
      └── PURGE → PURGED
                  ↓
              RE-UPLOAD → ACTIVE (revived)
```

---

# 🧩 Database Design

### Table: `files`

Relevant lifecycle columns:

```sql
deleted_at TEXT NULL
purged_at  TEXT NULL
```

---

# 📥 Upload Behavior

### Case 1 — New file

* Insert new row
* `deleted_at = NULL`
* `purged_at = NULL`

---

### Case 2 — Existing active file

* Update existing row

---

### Case 3 — Soft-deleted file exists

* Row is **revived**
* `deleted_at = NULL`
* `purged_at = NULL`

---

### Case 4 — Purged file exists

* Row is **revived**
* `deleted_at = NULL`
* `purged_at = NULL`
* New file replaces disk content

---

# 🗑️ Soft Delete

## Endpoint

```http
DELETE /files/{tenant}/{id}
```

## Behavior

* Sets:

```sql
deleted_at = now
```

* File becomes:

  * invisible in listing
  * inaccessible via read endpoint

## Notes

* Disk file is NOT removed
* Operation is safe and reversible

---

# ♻️ Restore

## Endpoint

```http
POST /files/{tenant}/{id}/restore
```

## Behavior

* Only allowed if:

  * `deleted_at IS NOT NULL`
  * `purged_at IS NULL`

* Sets:

```sql
deleted_at = NULL
```

* File becomes active again

---

## Failure Cases

| Condition           | Result                      |
| ------------------- | --------------------------- |
| File not found      | 404                         |
| File already active | 404                         |
| File purged         | 409 `FILE_ALREADY_PURGED`   |
| Disk file missing   | 409 `FILE_BINARY_NOT_FOUND` |

---

# 🧹 Purge (Physical Deletion)

## Endpoint

```http
POST /files/lifecycle/purge/{tenant}
```

## Query Parameters

| Param            | Description         |
| ---------------- | ------------------- |
| `limit`          | max number of files |
| `olderThanHours` | retention filter    |

---

## Behavior

* Selects files where:

```sql
deleted_at IS NOT NULL
AND purged_at IS NULL
AND deleted_at <= cutoff
```

* For each file:

1. Delete file from disk
2. Mark:

```sql
purged_at = now
```

---

## Result Example

```json
{
  "tenant": "baharsoft-demo",
  "purgedCount": 3,
  "failedCount": 0
}
```

---

# ⏳ Retention Policy

Default:

```text
7 days (168 hours)
```

Override via:

```http
?olderThanHours=0
```

---

# 🔁 Re-upload Behavior

Re-uploading a file with the same:

* tenant
* folder
* filename

### Behavior:

* Existing row (even purged) is reused
* Lifecycle fields reset:

```sql
deleted_at = NULL
purged_at = NULL
```

* File content is replaced

---

# 🔒 Authorization

Each operation requires:

| Operation | Permission |
| --------- | ---------- |
| Upload    | `upload`   |
| Read      | `read`     |
| Delete    | `delete`   |
| Restore   | `restore`  |
| Purge     | `purge`    |

---

# 🛡️ Consistency Guarantees

## Metadata-first principle

* Files are **never served without DB lookup**
* Missing metadata → file is inaccessible

---

## Upload safety

* Disk operation + DB write wrapped in rollback-safe logic
* Prevents inconsistent states

---

## Idempotency behavior

| Operation     | Behavior      |
| ------------- | ------------- |
| Delete twice  | 404           |
| Restore twice | 404           |
| Purge twice   | no effect     |
| Re-upload     | deterministic |

---

# ⚠️ Edge Cases Handled

* Re-upload after purge
* Restore after delete
* Prevent restore after purge
* MIME mismatch rejection
* Disk file missing
* Unique constraint conflicts resolved via revive

---

# 🚀 Future Enhancements

Not part of v1.0 but recommended:

* `deleted_by`, `restored_by`, `purged_by`
* audit log table
* scheduled purge job (cron / worker)
* admin listing of deleted/purged files
* hard delete DB records after long retention

---

# ✅ Summary

The system now provides:

* Safe deletion (soft delete)
* Reversible operations (restore)
* Controlled cleanup (purge + retention)
* Deterministic re-upload behavior
* Strong consistency via metadata-first design


