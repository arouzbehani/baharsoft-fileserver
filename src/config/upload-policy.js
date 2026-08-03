// src/config/upload-policy.js

const uploadPolicy = {
  defaultAction: "deny",

  denyExtensions: [
    ".exe",
    ".dll",
    ".bat",
    ".cmd",
    ".com",
    ".msi",
    ".sh",
    ".ps1",
    ".js",
    ".mjs",
    ".cjs",
    ".jar",
    ".php",
    ".aspx",
    ".jsp",
    ".html",
    ".htm",
    ".svg"
  ],

  denyMimePrefixes: [
    "application/x-ms",
    "application/x-executable"
  ],

  allowRules: [
    // ✅ Images
    {
      name: "images",
      mime: ["image/jpeg", "image/png", "image/webp"],
      extensions: [".jpg", ".jpeg", ".png", ".webp"],
      maxSizeBytes: 10 * 1024 * 1024
    },

    // ✅ PDF
    {
      name: "pdf",
      mime: ["application/pdf"],
      extensions: [".pdf"],
      maxSizeBytes: 20 * 1024 * 1024
    },

    // ✅ Text
    {
      name: "text",
      mime: ["text/plain"],
      extensions: [".txt"],
      maxSizeBytes: 1 * 1024 * 1024
    },

    // ✅ CSV
    {
      name: "csv",
      mime: ["text/csv", "application/vnd.ms-excel"],
      extensions: [".csv"],
      maxSizeBytes: 2 * 1024 * 1024
    },

    // ✅ JSON
    {
      name: "json",
      mime: ["application/json", "text/json"],
      extensions: [".json"],
      maxSizeBytes: 1 * 1024 * 1024
    },

    // ✅ Videos (keep controlled set)
    {
      name: "video",
      mime: [
        "video/mp4",
        "video/webm",
        "video/quicktime"
      ],
      extensions: [".mp4", ".webm", ".mov"],
      maxSizeBytes: 200 * 1024 * 1024 // 200MB
    },

    // ✅ Excel (modern + legacy)
    {
      name: "excel",
      mime: [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
        "application/vnd.ms-excel" // .xls
      ],
      extensions: [".xlsx", ".xls"],
      maxSizeBytes: 10 * 1024 * 1024
    },

    // ✅ Word
    {
      name: "word",
      mime: [
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
        "application/msword" // .doc
      ],
      extensions: [".docx", ".doc"],
      maxSizeBytes: 10 * 1024 * 1024
    }
  ]
};
module.exports = {
  uploadPolicy
};