if (process.env.ACCEPTANCES_EXTERNAL_CI !== "1") {
  console.error(
    "产品测试仅由外部 Agent/CI 执行；设置 ACCEPTANCES_EXTERNAL_CI=1 并显式选择 SUITE。",
  );
  process.exit(2);
}
if (process.argv[2] === "contract") {
  await import("./contract-check.mjs");
} else if (process.argv[2] === "platform") {
  await import("./platform-check.mjs");
} else if (
  ["domain", "cli", "postgres", "storage-local"].includes(process.argv[2])
) {
  await import("./go-check.mjs");
} else if (process.argv[2] === "e2e") {
  await import("./e2e-check.mjs");
} else {
  console.error(
    "可用 SUITE=platform|contract|domain|cli|postgres|storage-local|e2e；e2e 需要外部真实浏览器驱动。",
  );
  process.exit(2);
}
