const repo = require("../src/repositories/file.repository");

(async () => {
  const result = await repo.listFiles({
    tenant: "baharsoft-demo",
    folder: null,
    visibility: null,
    limit: 5,
    cursor: null,
  });

  console.log(result);
})();