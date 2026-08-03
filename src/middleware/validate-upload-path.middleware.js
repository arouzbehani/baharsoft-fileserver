const {
  normalizeFolder,
  normalizeTenant,
} = require("../utils/storage-paths");

function validateUploadPath(req, res, next) {
  try {
    req.fileTarget = {
      tenant: normalizeTenant(req.params[0]),
      folder: normalizeFolder(req.params[1], { required: true }),
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = validateUploadPath;
