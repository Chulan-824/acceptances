import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { formatDateTime } from "../src/lib/date.ts";

test("missing and unparseable timestamps display a placeholder", () => {
  for (const value of [undefined, null, "", "invalid", "   "])
    assert.equal(formatDateTime(value), "—");
});

test("timestamps use local time and preserve full, compact and date-only precision", () => {
  const moduleURL = new URL("../src/lib/date.ts", import.meta.url).href;
  const script = `
    import { formatDateTime } from ${JSON.stringify(moduleURL)};
    const timestamp = "2026-12-31T23:05:09.123Z";
    console.log(JSON.stringify([
      formatDateTime(timestamp),
      formatDateTime(timestamp, "MM-DD HH:mm"),
      formatDateTime(timestamp, "MM-DD"),
      formatDateTime("2027-01-01T07:05:09.123+08:00"),
      formatDateTime("2024-02-29T12:00:00"),
    ]));
  `;
  for (const [zone, full, compact, date] of [
    ["UTC", "2026-12-31 23:05:09", "12-31 23:05", "12-31"],
    ["Asia/Shanghai", "2027-01-01 07:05:09", "01-01 07:05", "01-01"],
    ["America/Los_Angeles", "2026-12-31 15:05:09", "12-31 15:05", "12-31"],
  ]) {
    const result = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { encoding: "utf8", env: { ...process.env, TZ: zone } },
    );
    assert.deepEqual(
      JSON.parse(result),
      [full, compact, date, full, "2024-02-29 12:00:00"],
      zone,
    );
  }
});
