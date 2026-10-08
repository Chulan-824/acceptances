import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const vectors = JSON.parse(
  readFileSync("contracts/fixtures/jcs-vectors.json", "utf8"),
);
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
const startedAt = new Date().toISOString();
for (const vector of vectors) {
  const bytes = canonical(JSON.parse(vector.input));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes !== vector.canonical || sha256 !== vector.sha256)
    throw new Error("Independent JCS vector mismatch");
}
execFileSync("go", ["test", "./internal/protocol", "-count=1"], {
  stdio: "inherit",
});
mkdirSync("artifacts", { recursive: true });
writeFileSync(
  "artifacts/contract.json",
  JSON.stringify(
    {
      acceptanceIds: ["A02", "A03", "A05"],
      startedAt,
      endedAt: new Date().toISOString(),
      environmentClass: "isolated-contract",
      vectors: vectors.length,
      outcome: "passed",
      limitations: [
        "Does not verify database references, HTTP authorization, publication, readiness, or deployed build identity",
        "A05 full dirty collection matrix remains pending",
      ],
    },
    null,
    2,
  ),
);
