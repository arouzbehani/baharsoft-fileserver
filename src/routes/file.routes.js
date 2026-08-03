const express = require("express");

const router = express.Router();

const upload = require("../middleware/upload.middleware");
const fileController = require("../controllers/file.controller");

const optionalAuth = require("../middleware/auth/optionalAuth");
const requireAuth = require("../middleware/auth/requireAuth");
const requireTenantAccess = require("../middleware/auth/requireTenantAccess");
const validateUploadPath = require("../middleware/validate-upload-path.middleware");

// GET /files/list/{tenant}
router.get(
  /^\/list\/([^\/]+)$/,
  requireAuth,
  requireTenantAccess("read"),
  fileController.listFiles
);

// GET /files/document/{tenant}/{documentId}
router.get(
  /^\/document\/([^\/]+)\/([^\/]+)$/,
  optionalAuth,
  fileController.getFileByDocumentId
);

// GET /files/{tenant}/{anything...}
router.get(
  /^\/([^\/]+)\/(.+)/,
  optionalAuth,
  fileController.getFile
);

// POST /files/upload/{tenant}/{folder...}
router.post(
  /^\/upload\/([^\/]+)\/(.+)/,
  requireAuth,
  requireTenantAccess("upload"),
  validateUploadPath,
  upload.single("file"),
  fileController.uploadFile
);
// DELETE /files/{tenant}/{id}
router.delete(
  /^\/([^\/]+)\/([^\/]+)$/,
  requireAuth,
  requireTenantAccess("delete"),
  fileController.deleteFile
);
// POST /files/lifecycle/purge/{tenant}
router.post(
  /^\/lifecycle\/purge\/([^\/]+)$/,
  requireAuth,
  requireTenantAccess("purge"),
  fileController.purgeDeletedFiles
);
// POST /files/{tenant}/{id}/restore
router.post(
  /^\/([^\/]+)\/([^\/]+)\/restore$/,
  requireAuth,
  requireTenantAccess("restore"),
  fileController.restoreDeletedFile
);
module.exports = router;
