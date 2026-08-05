const { getRuntimeConfig } = require("./config/env");

async function start(config) {
  try {
    const runtimeConfig = config || getRuntimeConfig();
    const { createApp } = require("./app");
    const { initializeDb, pingDb, closeDb } = require("./db/sqlite");

    await initializeDb();
    const app = createApp({
      adminPath: runtimeConfig.adminPath,
      readinessCheck: pingDb,
      serviceVersion: runtimeConfig.serviceVersion,
    });
    const server = app.listen(runtimeConfig.port);

    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });

    console.log(
      JSON.stringify({
          level: "info",
          event: "server_started",
          port: server.address().port,
        environment: runtimeConfig.nodeEnv,
        version: runtimeConfig.serviceVersion,
      }),
    );

    let shuttingDown = false;

    async function shutdown(signal) {
      if (shuttingDown) return;
      shuttingDown = true;

      console.log(
        JSON.stringify({ level: "info", event: "shutdown_started", signal }),
      );

      const forceExitTimer = setTimeout(() => {
        console.error(
          JSON.stringify({ level: "error", event: "shutdown_timed_out" }),
        );
        process.exit(1);
      }, 10000);
      forceExitTimer.unref();

      server.close(async (serverError) => {
        try {
          await closeDb();
          clearTimeout(forceExitTimer);

          if (serverError) throw serverError;

          console.log(
            JSON.stringify({ level: "info", event: "shutdown_completed" }),
          );
          process.exit(0);
        } catch (error) {
          console.error(
            JSON.stringify({
              level: "error",
              event: "shutdown_failed",
              message: error.message,
            }),
          );
          process.exit(1);
        }
      });
    }

    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));

    return server;
  } catch (error) {
    try {
      const { closeDb } = require("./db/sqlite");
      await closeDb();
    } catch (closeError) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "database_close_failed",
          message: closeError.message,
        }),
      );
    }

    console.error(
      JSON.stringify({
        level: "error",
        event: "server_start_failed",
        message: error.message,
      }),
    );
    throw error;
  }
}

if (require.main === module) {
  start().catch(() => {
    process.exit(1);
  });
}

module.exports = {
  start,
};
