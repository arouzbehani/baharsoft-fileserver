# Baharsoft File Server – MIME Handling & File Validation (Phase 1)

## Overview

This document describes the implementation of MIME handling, file validation, and safe file serving in the Baharsoft multi-tenant file server.

The goal of this phase was to move from a basic upload system to a **secure, metadata-driven, production-ready file handling pipeline**.

---

# Initial State (Before Changes)

The system initially had:

### Upload

* Files uploaded directly to final storage path:

  ```
  /storage/tenants/{tenant}/{folder}/{file}
  ```
* Multer middleware handled:

  * file naming
  * directory creation
  * MIME filtering via hardcoded whitelist

### Validation

* Only relied on:

  ```js
  file.mimetype
  ```
* No content-based validation
* No extension checks

### Metadata

Stored in SQLite:

* tenant
* folder
* relative_path
* stored_name
* original_name
* visibility
* mime_type (from client)
* size
* uploaded_at
* uploaded_by

### Read

* Served files using stored `mime_type`
* No anti-sniff protection
* No streaming support

---

# Problems Identified

* ❌ MIME type could be spoofed by client
* ❌ No detection of file content
* ❌ Dangerous files could bypass checks
* ❌ No mismatch detection (e.g. `.jpg` → actually `.pdf`)
* ❌ No per-type size limits
* ❌ Middleware performed business logic (bad separation)
* ❌ No protection against MIME sniffing
* ❌ Videos not streamed properly

---

# Final Architecture (After Implementation)

## Upload Flow

```
Client → Multer (temp storage) → Validation Service → File Service → Storage + DB
```

### Key Change:

👉 Validation moved from middleware → service layer

---

# Step 1: Upload Policy (Config Layer)

Created:

```
src/config/upload-policy.js
```

Defines:

* allowed MIME types
* allowed extensions
* denied extensions
* per-type size limits

### Example:

```js
{
  name: "video",
  mime: ["video/mp4", "video/webm"],
  extensions: [".mp4", ".webm"],
  maxSizeBytes: 200 * 1024 * 1024
}
```

### Key Principle:

👉 Default = **deny**

---

# Step 2: File Validation Service

Created:

```
src/services/file-validation.service.js
```

## Responsibilities

* extract extension
* normalize MIME
* detect actual file type (via file signature)
* compare:

  * declared MIME
  * detected MIME
  * extension
* apply upload policy
* return structured result

## Output Example

```js
{
  ok: true,
  trustedMimeType: "application/pdf",
  declaredMimeType: "application/pdf",
  detectedMimeType: "application/pdf",
  extension: ".pdf"
}
```

---

## Important Behavior

### Binary files (PDF, images, video)

* detected via file signature
* high confidence

### Text files (TXT, CSV, JSON)

* detection may return null
* fallback logic used

---

# Step 3: Upload Flow Refactor

## Middleware Changes

### Before:

* validated MIME
* wrote directly to final storage

### After:

* writes to temp folder only
* no MIME validation

---

## File Service Changes

### New responsibilities:

* call validation service
* reject invalid files
* move validated file to final location
* store trusted metadata

---

## Metadata Source

| Field              | Source           |
| ------------------ | ---------------- |
| mime_type          | trusted (server) |
| declared_mime_type | client           |
| detected_mime_type | file content     |
| file_extension     | filename         |

---

# Step 4: Database Upgrade

## New Columns Added

```sql
declared_mime_type TEXT
detected_mime_type TEXT
file_extension TEXT
```

## Migration Strategy

* used `PRAGMA table_info`
* added columns only if missing
* no data loss

---

## Final Metadata Model

| Column             | Meaning                         |
| ------------------ | ------------------------------- |
| mime_type          | trusted MIME (used for serving) |
| declared_mime_type | client-provided                 |
| detected_mime_type | content-detected                |
| file_extension     | normalized extension            |

---

# Step 5: Secure File Serving

## Improvements

### 1. Trusted MIME only

```js
res.type(metadata.mimeType);
```

### 2. Anti-sniff protection

```js
res.setHeader("X-Content-Type-Options", "nosniff");
```

### 3. Cache control

* public → cache enabled
* private → no-store

---

## Inline vs Attachment Rules

### Inline allowed for:

* images
* text
* pdf
* video

### Attachment forced for:

* office files
* unknown types
* risky extensions

---

# Step 5.1: Video Streaming Support

## Added Range Request Handling

Supports:

* partial content (206)
* seeking
* buffering

### Headers used:

```http
Accept-Ranges: bytes
Content-Range: bytes X-Y/total
```

---

## Result

* videos play in browser
* seeking works
* no forced download

---

# Final Upload Pipeline

```
1. Upload → temp storage
2. Validation service:
   - extension check
   - MIME detection
   - mismatch detection
   - size validation
3. If valid:
   - move to final storage
   - insert metadata
4. If invalid:
   - delete temp file
   - return error
```

---

# Security Improvements

## Achieved

* ✅ Prevent MIME spoofing
* ✅ Detect mismatched file types
* ✅ Block dangerous extensions
* ✅ Per-type size limits
* ✅ Metadata-first trust model
* ✅ Anti-sniff protection
* ✅ Safe serving rules
* ✅ Video streaming support

---

# Design Principles Applied

* Metadata-first architecture
* Separation of concerns:

  * middleware → transport only
  * service → business logic
* deny-by-default security model
* incremental improvements (no rewrite)

---

# Known Limitations (Accepted)

* No antivirus scanning
* No deep content inspection
* No SVG sanitization (currently blocked)
* No async scanning pipeline

These are intentionally deferred.

---

# Current Status

The file server now supports:

* secure uploads
* MIME-aware validation
* safe serving
* video streaming
* extensible policy system

👉 This is considered a **production-ready baseline for file handling**

---

# Next Steps (Out of Scope for This Phase)

* file listing API (pagination, filters)
* delete / lifecycle management
* storage abstraction (S3 / MinIO)
* rate limiting & abuse protection

---

# Summary

This phase successfully transformed the file server from a basic upload system into a **secure, extensible, metadata-driven file management system**, while keeping the architecture simple and incremental.

---
