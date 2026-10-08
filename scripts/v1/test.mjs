if (process.env.ACCEPTANCES_EXTERNAL_CI !== "1") {
  console.error(
    "产品测试仅由外部 Agent/CI 执行；设置 ACCEPTANCES_EXTERNAL_CI=1 并显式选择 SUITE。",
  );
  process.exit(2);
}
if (process.argv[2] !== "platform") {
  console.error(
    "基础阶段仅定义 SUITE=platform；其他分组尚未实现，不记为通过。",
  );
  process.exit(2);
}
await import("./platform-check.mjs");
