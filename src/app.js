const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const fileRoutes = require("./routes/file.routes");
const errorMiddleware = require("./middleware/error.middleware");
const packageMetadata = require("../package.json");

function createApp({
  adminPath = "/admin",
  readinessCheck = async () => true,
  serviceVersion = packageMetadata.version,
} = {}) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));

  app.get("/health/live", (req, res) => {
    res.status(200).json({ status: "ok", version: serviceVersion });
  });

  app.get("/health/ready", async (req, res, next) => {
    try {
      const ready = await readinessCheck();

      if (!ready) {
        return res.status(503).json({
          status: "unavailable",
          error: "SERVICE_NOT_READY",
        });
      }

      return res.status(200).json({ status: "ok", version: serviceVersion });
    } catch (error) {
      error.status = 503;
      error.code = "SERVICE_NOT_READY";
      return next(error);
    }
  });

  app.use("/auth", authRoutes);
  app.use("/files", fileRoutes);

  const adminApiPath = `${adminPath}/api`;
  app.use(adminApiPath, adminRoutes);

  const adminDist = path.resolve(__dirname, "../admin-ui/dist");
  if (fs.existsSync(adminDist)) {
    const escapedAdminPath = adminPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    app.get(new RegExp(`^${escapedAdminPath}$`), (req, res) => {
      res.redirect(308, `${adminPath}/`);
    });
    app.use(adminPath, express.static(adminDist, { index: false }));
    app.get(
      new RegExp(`^${escapedAdminPath}/(?!assets/|api(?:/|$)).*`),
      (req, res) => {
        res.sendFile(path.join(adminDist, "index.html"));
      },
    );
  }

  app.use((req, res) => {
    res.status(404).json({ error: "ROUTE_NOT_FOUND" });
  });

  app.use(errorMiddleware);

  return app;
}

module.exports = {
  createApp,
};
