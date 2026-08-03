const express = require("express");
const adminController = require("../controllers/admin.controller");
const tokenRateLimit = require("../middleware/token-rate-limit.middleware");
const upload = require("../middleware/upload.middleware");
const validateUploadPath = require("../middleware/validate-upload-path.middleware");
const {
  requireAdmin,
  requireAdminCsrf,
} = require("../middleware/admin-auth.middleware");

const router = express.Router();

router.get("/setup/status", adminController.setupStatus);
router.post("/setup", tokenRateLimit, adminController.setup);
router.post("/login", tokenRateLimit, adminController.login);
router.get("/session", requireAdmin, adminController.session);
router.post("/logout", requireAdmin, requireAdminCsrf, adminController.logout);

router.get("/clients", requireAdmin, adminController.listClients);
router.post(
  "/clients",
  requireAdmin,
  requireAdminCsrf,
  adminController.createClient,
);
router.put(
  "/clients/:clientId",
  requireAdmin,
  requireAdminCsrf,
  adminController.updateClient,
);
router.post(
  "/clients/:clientId/rotate-secret",
  requireAdmin,
  requireAdminCsrf,
  adminController.rotateClient,
);
router.post(
  "/clients/:clientId/enable",
  requireAdmin,
  requireAdminCsrf,
  adminController.setClientState(true),
);
router.post(
  "/clients/:clientId/disable",
  requireAdmin,
  requireAdminCsrf,
  adminController.setClientState(false),
);

router.get("/tenants", requireAdmin, adminController.listTenants);
router.get("/files/:tenant", requireAdmin, adminController.listFiles);
router.post(
  /^\/files\/([^\/]+)\/upload\/(.+)/,
  requireAdmin,
  requireAdminCsrf,
  validateUploadPath,
  upload.single("file"),
  adminController.uploadFile,
);
router.get(
  "/files/:tenant/:documentId/content",
  requireAdmin,
  adminController.getFileContent,
);
router.delete(
  "/files/:tenant/:documentId",
  requireAdmin,
  requireAdminCsrf,
  adminController.deleteFile,
);
router.post(
  "/files/:tenant/:documentId/restore",
  requireAdmin,
  requireAdminCsrf,
  adminController.restoreFile,
);
router.post(
  "/files/:tenant/:documentId/purge",
  requireAdmin,
  requireAdminCsrf,
  adminController.purgeFile,
);

module.exports = router;
