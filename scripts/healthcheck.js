const port = process.env.PORT || "3000";

fetch(`http://127.0.0.1:${port}/health/ready`, {
  signal: AbortSignal.timeout(4000),
})
  .then((response) => {
    if (!response.ok) {
      throw new Error(`Readiness returned HTTP ${response.status}`);
    }
  })
  .catch((error) => {
    console.error(`Container health check failed: ${error.message}`);
    process.exit(1);
  });
