const multer = require("multer");

function errorMiddleware(err, req, res, next) {
  const isMulterError = err instanceof multer.MulterError;
  const status = Number.isInteger(err.status)
    ? err.status
    : isMulterError
      ? 400
      : 500;
  const code =
    err.code ||
    (isMulterError ? "UPLOAD_REJECTED" : "INTERNAL_SERVER_ERROR");

  console.error(
    JSON.stringify({
      level: "error",
      event: "request_failed",
      method: req.method,
      path: req.originalUrl,
      status,
      code,
      message: err.message,
    }),
  );

  const body = { error: code };

  if (status < 500 && err.message) {
    body.message = err.message;
  }

  return res.status(status).json(body);
}

module.exports = errorMiddleware;
