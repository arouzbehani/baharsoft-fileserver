const fileService = require("../src/services/file.service");

(async () => {
  const result = await fileService.listFilesForTenant({
    tenant: "baharsoft-demo",
    folder: null,
    visibility: null,
    limit: 2,
    cursor: null,
  });

  console.log(JSON.stringify(result, null, 2));
})();