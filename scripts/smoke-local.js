const baseUrl = String(
  process.env.FILESERVER_BASE_URL || "http://127.0.0.1:3000",
).replace(/\/+$/, "");

async function checkEndpoint(path) {
  const response = await fetch(`${baseUrl}${path}`);
  let body = null;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(
      `${path} returned ${response.status}: ${JSON.stringify(body)}`,
    );
  }

  console.log(`${path}: ${response.status} ${JSON.stringify(body)}`);
}

async function main() {
  await checkEndpoint("/health/live");
  await checkEndpoint("/health/ready");
  console.log(`Local smoke check passed for ${baseUrl}.`);
}

main().catch((error) => {
  console.error(`Local smoke check failed: ${error.message}`);
  process.exit(1);
});
