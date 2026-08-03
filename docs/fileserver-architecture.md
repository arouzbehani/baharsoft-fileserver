# 📁 Multi-Tenant File Server (Node.js / Express)

## Overview

This file server is designed as a **reusable, multi-tenant service** for managing file uploads and downloads with secure access control.

It separates:

* **Binary storage (disk)**
* **Access control + metadata (SQLite)**

The system enforces **per-file visibility** and **JWT-based authorization**, making it suitable for use across multiple projects.

---

## 🎯 Core Design Principles

1. **Disk is not trusted**

   * Files are never served directly based on existence
   * Metadata in SQLite is the source of truth

2. **Per-file visibility**

   * `public` → accessible without authentication
   * `private` → requires valid JWT

3. **Tenant isolation**

   * Every file belongs to a tenant
   * Access is restricted via JWT claims

4. **Fileserver is not responsible for business logic**

   * Only handles:

     * public vs private
     * tenant access
     * permissions
   * Fine-grained access control is handled by consuming apps

---

## 🏗 Architecture

```txt
Client / Backend
      |
      |  Authorization: Bearer <JWT>
      v
File Server (Express)
      |
      ├── Auth Middleware (JWT validation)
      ├── File Service (business logic)
      ├── Repository (SQLite)
      └── Disk Storage (binary files)
```

---

## 📂 Project Structure

```txt
src/
  config/
    storage.js
    auth.js

  db/
    sqlite.js

  repositories/
    file.repository.js

  services/
    file.service.js

  middleware/
    upload.middleware.js
    auth/
      optionalAuth.js
      requireAuth.js
      requireTenantAccess.js

  controllers/
    file.controller.js

  routes/
    file.routes.js

  server.js
```

---

## 🔐 Authentication & Authorization

### JWT Format

```json
{
  "sub": "crm-api",
  "tenants": ["baharsoft-demo"],
  "permissions": ["read", "upload"],
  "exp": 1770000000
}
```

### Required Headers

```http
Authorization: Bearer <token>
```

### Middleware

| Middleware                        | Description                   |
| --------------------------------- | ----------------------------- |
| `optionalAuth`                    | Parses token if present       |
| `requireAuth`                     | Requires valid JWT            |
| `requireTenantAccess(permission)` | Validates tenant + permission |

---

## 🗄 Database (SQLite)

### Table: `files`

| Column        | Description             |
| ------------- | ----------------------- |
| tenant        | Tenant identifier       |
| folder        | Logical folder          |
| relative_path | Unique logical path     |
| stored_name   | Actual filename on disk |
| original_name | Original uploaded name  |
| visibility    | `public` or `private`   |
| mime_type     | File MIME type          |
| size          | File size               |
| uploaded_at   | Timestamp               |
| uploaded_by   | JWT `sub`               |

### Unique Constraint

```txt
(tenant, relative_path)
```

---

## 📤 Upload Flow

### Endpoint

```http
POST /files/upload/{tenant}/{folder...}
```

### Requirements

* JWT required
* Must have:

  * tenant access
  * `upload` permission

### Query Parameters

| Param      | Description                         |
| ---------- | ----------------------------------- |
| overwrite  | true / false (default: false)       |
| visibility | public / private (default: private) |

### Behavior

Every upload is first written with a random name under the quarantine root.
Tenant, folder, filename, content, and size validation must pass before the
binary is published into tenant storage.

#### overwrite=true

* Replace existing file
* Update metadata

#### overwrite=false

* Generate new filename:

  ```
  copy_filename.ext
  copy_2_filename.ext
  ```
* Create new metadata row

---

## 📥 Read Flow

### Endpoint

```http
GET /files/{tenant}/{path}
```

### Flow

1. Resolve tenant + path safely
2. Lookup metadata in SQLite
3. If not found → `404`
4. If public → allow
5. If private:

   * require JWT
   * require tenant access
   * require `read` permission
6. Serve file

---

## 🔒 Security Model

### Protected Against

* Path traversal
* Unauthorized access
* Fake JWT tokens
* Direct disk exposure
* Unmanaged file access

### Important Rule

> A file is only accessible if it exists in the database.

---

## 🧠 Visibility Model

| Visibility | Behavior                 |
| ---------- | ------------------------ |
| public     | accessible without token |
| private    | requires JWT             |

There is **no “custom” visibility**.

---

## 📁 Storage Layout

```txt
/storage/tenants/{tenant}/{folder}/{file}
```

Example:

```txt
storage/tenants/baharsoft-demo/docs/sample.txt
```

---

## 🔄 Logical vs Physical Path

| Type            | Example                                    |
| --------------- | ------------------------------------------ |
| Logical (DB)    | `docs/sample.txt`                          |
| Physical (disk) | `/storage/tenants/baharsoft-demo/docs/sample.txt` |

---

## ⚙️ Environment Variables

| Variable                  | Description                             |
| ------------------------- | --------------------------------------- |
| FILESERVER_JWT_SECRET     | JWT signing secret (minimum 32 chars)   |
| PORT                      | HTTP port (default `3000`)              |
| FILESERVER_DATA_ROOT      | Metadata data directory                 |
| FILESERVER_STORAGE_ROOT   | Binary storage directory                |
| FILESERVER_DB_PATH        | SQLite database path                    |
| FILESERVER_QUARANTINE_ROOT| Pre-validation upload directory         |

Example (PowerShell):

```powershell
$env:FILESERVER_JWT_SECRET="replace-with-a-random-secret-of-at-least-32-characters"
```

---

## 🧪 Testing Examples

### Upload

```powershell
curl.exe -X POST `
  -H "Authorization: Bearer $token" `
  -F "file=@sample.txt;type=text/plain" `
  "http://localhost:3000/files/upload/baharsoft-demo/docs"
```

### Read (private)

```powershell
curl.exe `
  -H "Authorization: Bearer $token" `
  "http://localhost:3000/files/baharsoft-demo/docs/sample.txt"
```

### Read (public)

```powershell
curl.exe "http://localhost:3000/files/baharsoft-demo/docs/sample.txt"
```

---

## 🚀 Current Status

### Implemented

* JWT authentication
* Tenant + permission validation
* SQLite metadata storage
* Secure upload
* Metadata-first read
* Public/private visibility
* Overwrite & copy logic

### Not Yet Implemented

* File deletion
* Metadata listing/search
* Rate limiting
* File type extensibility
* Storage abstraction (S3, etc.)

---

## 📌 Design Boundary

The file server is responsible for:

* file storage
* metadata
* visibility (public/private)
* JWT validation
* tenant isolation

It is NOT responsible for:

* end-user authorization
* business rules
* ownership logic

---

## 🧭 Future Improvements

* switch to RS256 (public/private key)
* add file listing API
* add delete endpoint
* add audit logs
* support external storage (S3, MinIO)
* configurable MIME whitelist

---

## 💡 Final Note

This system is designed to be:

* simple
* secure
* reusable
* extensible

