const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const roots = ["src", "scripts", "test"];
const projectRoot = path.resolve(__dirname, "..");
const files = [];

function collectJavaScriptFiles(relativeDirectory) {
  const absoluteDirectory = path.join(projectRoot, relativeDirectory);

  if (!fs.existsSync(absoluteDirectory)) return;

  for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);

    if (entry.isDirectory()) {
      collectJavaScriptFiles(relativePath);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(relativePath);
    }
  }
}

for (const root of roots) {
  collectJavaScriptFiles(root);
}

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: projectRoot,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);
