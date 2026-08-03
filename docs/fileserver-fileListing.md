Here is a clean, production-style documentation you can drop directly into your project (e.g. `docs/file-listing.md`).

---

```md
# File Server — File Listing API (v1)

## 📌 Overview

This document describes the implementation of the **File Listing API** in the multi-tenant file server.

The system follows a **metadata-first architecture**, where:

- Files are stored on disk:
```

/storage/tenants/{tenant}/{folder}/{file}

````
- SQLite stores all metadata (source of truth)
- Files are **never accessed directly from disk without metadata lookup**

---

## 🧱 Initial State (Before This Work)

The system already supported:

### ✅ Authentication

- JWT-based
- Token structure:
```json
{
  "sub": "user-id",
  "tenants": ["tenant1"],
  "permissions": ["read", "upload"]
}
````

* Middleware:

  * `optionalAuth`
  * `requireAuth`
  * `requireTenantAccess(permission)`

---

### ✅ Upload System

* Uses Multer → temporary storage
* Validation handled in service layer
* File validation includes:

  * MIME detection (content-based)
  * extension check
  * mismatch detection
  * per-type size limits
  * deny-by-default policy

---

### ✅ File Serving

* Metadata lookup first
* Trusted MIME only
* Secure headers:

  * `X-Content-Type-Options: nosniff`
* Inline vs attachment logic
* Video streaming support:

  * `206 Partial Content`
  * Range requests

---

### ✅ Database (SQLite)

Table: `files`

Key fields:

* `tenant`
* `folder`
* `relative_path`
* `visibility`
* `mime_type`
* `size`
* `uploaded_at`

---

## 🎯 Goal of This Phase

Implement a **production-ready File Listing API** with:

* multi-tenant support
* filtering (folder, visibility)
* cursor-based pagination
* secure access control
* clean API response
* scalable query performance

---

# 🚀 What We Implemented

## 1. Repository Layer — `listFiles()`

Added a new method:

```js
listFiles({ tenant, folder, visibility, limit, cursor })
```

### Behavior

* Filters:

  * tenant (required)
  * folder (optional)
  * visibility (optional)

* Pagination:

  * cursor-based
  * uses:

    ```sql
    ORDER BY uploaded_at DESC, id DESC
    ```

* Cursor condition:

  ```sql
  (
    uploaded_at < ?
    OR (uploaded_at = ? AND id < ?)
  )
  ```

* Fetches `limit + 1` rows to detect `hasMore`

---

## 2. Service Layer — `listFilesForTenant()`

Handles:

### ✅ Input normalization

* `folder`
* `visibility`
* `limit`
* `cursor`

### ✅ Validation

* invalid visibility → `400`
* invalid limit → `400`
* invalid cursor → `400`

### ✅ Cursor system

#### Encode:

```txt
uploaded_at|id → base64
```

#### Decode:

```txt
base64 → uploaded_at + id
```

---

### ✅ Pagination response

```json
{
  "items": [...],
  "page": {
    "limit": 20,
    "hasMore": true,
    "nextCursor": "..."
  }
}
```

---

## 3. Controller Layer — `listFiles`

Added new handler:

```js
GET /files/list/{tenant}
```

Responsibilities:

* extract params
* call service
* return JSON response

---

## 4. Route Layer

Added route:

```js
router.get(
  /^\/list\/([^\/]+)$/,
  requireAuth,
  requireTenantAccess("read"),
  fileController.listFiles
);
```

### ⚠️ Important

Route order matters.

This must be placed **before**:

```js
/^\/([^\/]+)\/(.+)/
```

Otherwise listing requests will be captured by file-read route.

---

## 5. Database Performance (Indexes)

Added:

```sql
CREATE INDEX idx_files_tenant_uploaded_id
ON files (tenant, uploaded_at DESC, id DESC);

CREATE INDEX idx_files_tenant_folder_uploaded_id
ON files (tenant, folder, uploaded_at DESC, id DESC);
```

### Purpose

* optimize listing queries
* support cursor pagination
* scale for large tenants

---

## 6. Response Shaping (API Contract)

Introduced a clean API response model:

```json
{
  "id": 15,
  "tenant": "baharsoft-demo",
  "folder": "videos",
  "originalName": "test.webm",
  "visibility": "public",
  "mimeType": "video/webm",
  "size": 87977555,
  "uploadedAt": "2026-04-02T05:57:25.507Z",
  "url": "/files/baharsoft-demo/videos/test.webm"
}
```

### Removed internal fields

* `storedName`
* `relativePath`
* `uploadedBy`

---

## 7. Final API Endpoint

### Request

```http
GET /files/list/{tenant}
Authorization: Bearer <JWT>
```

### Query Parameters

| Param        | Description                     |
| ------------ | ------------------------------- |
| `limit`      | max items (default 20, max 100) |
| `folder`     | exact folder match              |
| `visibility` | `public` or `private`           |
| `cursor`     | pagination cursor               |

---

### Example

```http
GET /files/list/baharsoft-demo?limit=2
```

---

### Response

```json
{
  "items": [...],
  "page": {
    "limit": 2,
    "hasMore": true,
    "nextCursor": "..."
  }
}
```

---

## 🔁 Pagination Flow

1. First request:

   ```http
   GET /files/list/baharsoft-demo?limit=2
   ```

2. Response:

   ```json
   {
     "nextCursor": "abc123"
   }
   ```

3. Next request:

   ```http
   GET /files/list/baharsoft-demo?limit=2&cursor=abc123
   ```

---

## 🛡 Security Model

* Requires authentication
* Requires tenant access
* Requires `"read"` permission

---

## 🧠 Design Decisions

### Why cursor-based pagination?

* avoids OFFSET performance issues
* stable under concurrent uploads
* index-friendly
* production scalable

---

### Why service-level shaping?

* repository = raw data
* service = business logic
* controller = transport

---

### Why hide internal fields?

* prevent tight coupling
* allow storage refactoring later
* safer API contract

---

## 📊 Current Status

### ✅ Completed

* repository listing
* service pagination + validation
* controller endpoint
* route integration
* DB indexing
* response shaping

---

### 🔜 Next Steps (Future Work)

* delete / lifecycle management
* soft delete (`deleted_at`)
* recursive folder listing
* search capability
* storage abstraction (S3 / MinIO)
* caching layer
* rate limiting

---

## 🧩 Summary

The file server now supports:

* secure multi-tenant file listing
* cursor-based pagination
* production-ready performance
* clean API contract

This is the first **read-side scaling feature** of the system.

