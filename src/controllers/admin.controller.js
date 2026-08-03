const { getRuntimeConfig } = require("../config/env");
const {
  getSetupStatus,
  login,
  logout,
  setupFirstAdmin,
} = require("../services/admin-auth.service");
const {
  getPublicClients,
  provisionClient,
  rotateClient,
  setClientActive,
  updateClient,
} = require("../services/service-client.service");
const { ADMIN_COOKIE_NAME } = require("../middleware/admin-auth.middleware");
const fileController = require("./file.controller");
const fileService = require("../services/file.service");
const {
  listAdminFiles,
  listKnownTenants,
} = require("../services/admin-file.service");

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

function sessionCookie(value, maxAge = 0) {
  const config = getRuntimeConfig();
  const parts = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ];
  if (config.nodeEnv === "production") parts.push("Secure");
  return parts.join("; ");
}

function sessionResponse(res, session, status = 200) {
  const config = getRuntimeConfig();
  setNoStore(res);
  res.setHeader(
    "Set-Cookie",
    sessionCookie(session.token, config.adminSessionTtlSeconds),
  );
  return res.status(status).json({
    admin: session.admin,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  });
}

exports.setupStatus = async (req, res, next) => {
  try {
    setNoStore(res);
    return res.json(await getSetupStatus());
  } catch (error) {
    return next(error);
  }
};

exports.setup = async (req, res, next) => {
  try {
    return sessionResponse(res, await setupFirstAdmin(req.body || {}), 201);
  } catch (error) {
    return next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    return sessionResponse(res, await login(req.body || {}));
  } catch (error) {
    return next(error);
  }
};

exports.logout = async (req, res, next) => {
  try {
    await logout(req.adminSessionToken);
    setNoStore(res);
    res.setHeader("Set-Cookie", sessionCookie("", 0));
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
};

exports.session = (req, res) => {
  setNoStore(res);
  return res.json({
    admin: req.adminSession.admin,
    csrfToken: req.adminSession.csrf_token,
    expiresAt: req.adminSession.expires_at,
  });
};

exports.listClients = async (req, res, next) => {
  try {
    return res.json({ clients: await getPublicClients() });
  } catch (error) {
    return next(error);
  }
};

exports.createClient = async (req, res, next) => {
  try {
    setNoStore(res);
    return res.status(201).json(await provisionClient(req.body || {}));
  } catch (error) {
    return next(error);
  }
};

exports.updateClient = async (req, res, next) => {
  try {
    return res.json(
      await updateClient({ ...(req.body || {}), clientId: req.params.clientId }),
    );
  } catch (error) {
    return next(error);
  }
};

exports.rotateClient = async (req, res, next) => {
  try {
    setNoStore(res);
    return res.json(await rotateClient(req.params.clientId));
  } catch (error) {
    return next(error);
  }
};

exports.setClientState = (active) => async (req, res, next) => {
  try {
    return res.json(await setClientActive(req.params.clientId, active));
  } catch (error) {
    return next(error);
  }
};

function adminFilePrincipal(req, tenant) {
  return {
    sub: `admin:${req.adminSession.admin.username}`,
    clientId: null,
    tenants: [tenant],
    permissions: ["upload", "read", "delete", "restore", "purge"],
  };
}

exports.listTenants = async (req, res, next) => {
  try {
    return res.json({ tenants: await listKnownTenants() });
  } catch (error) {
    return next(error);
  }
};

exports.listFiles = async (req, res, next) => {
  try {
    return res.json(
      await listAdminFiles({ ...req.query, tenant: req.params.tenant }),
    );
  } catch (error) {
    return next(error);
  }
};

exports.uploadFile = async (req, res, next) => {
  try {
    if (!req.file) {
      const error = new Error("A file is required");
      error.code = "FILE_REQUIRED";
      error.status = 400;
      throw error;
    }
    const tenant = req.fileTarget.tenant;
    const saved = await fileService.handleUpload({
      tenant,
      folder: req.fileTarget.folder,
      file: req.file,
      visibilityInput: req.query.visibility,
      overwriteInput: "false",
      metadataInput: req.body?.metadata,
      auth: adminFilePrincipal(req, tenant),
    });
    return res.status(201).json({
      file: {
        id: saved.id,
        documentId: saved.publicId,
        tenant: saved.tenant,
        folder: saved.folder,
        originalName: saved.originalName,
        storedName: saved.storedName,
        visibility: saved.visibility,
        mimeType: saved.mimeType,
        size: saved.size,
        uploadedAt: saved.uploadedAt,
        uploadedBy: saved.uploadedBy,
        checksumSha256: saved.checksumSha256,
        status: saved.status,
        tags: saved.tags,
      },
    });
  } catch (error) {
    return next(error);
  }
};

exports.getFileContent = async (req, res, next) => {
  try {
    const { tenant, documentId } = req.params;
    const result = await fileService.getAuthorizedFileByDocumentId({
      tenant,
      documentId,
      auth: adminFilePrincipal(req, tenant),
    });
    return fileController.serveAuthorizedFile(req, res, next, result);
  } catch (error) {
    return next(error);
  }
};

exports.deleteFile = async (req, res, next) => {
  try {
    const { tenant, documentId } = req.params;
    return res.json(
      await fileService.softDeleteFile({
        tenant,
        id: documentId,
        auth: adminFilePrincipal(req, tenant),
      }),
    );
  } catch (error) {
    return next(error);
  }
};

exports.restoreFile = async (req, res, next) => {
  try {
    const { tenant, documentId } = req.params;
    return res.json(
      await fileService.restoreDeletedFile({
        tenant,
        id: documentId,
        auth: adminFilePrincipal(req, tenant),
      }),
    );
  } catch (error) {
    return next(error);
  }
};

exports.purgeFile = async (req, res, next) => {
  try {
    const { tenant, documentId } = req.params;
    return res.json(
      await fileService.purgeDeletedFile({
        tenant,
        id: documentId,
        auth: adminFilePrincipal(req, tenant),
      }),
    );
  } catch (error) {
    return next(error);
  }
};
