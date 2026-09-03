import fs from "node:fs";
import path from "node:path";

import { loadRound } from "./acceptances.js";
import { shanghaiNow } from "./time.js";

export function writeReview(root, subject, round, { id, action, reason }) {
  const { dir, result, reviews } = loadRound(root, subject, round);
  const ids = new Set((result.cases || []).map((entry) => entry.id));
  if (!ids.has(id)) {
    throw Object.assign(new Error(`unknown case id: ${id}`), { status: 400 });
  }
  if (action !== "accept" && action !== "reject") {
    throw Object.assign(new Error("action must be accept or reject"), {
      status: 400,
    });
  }

  const entry = { action, reviewedAt: shanghaiNow() };
  if (action === "reject") {
    const text = String(reason ?? "").trim();
    if (!text) {
      throw Object.assign(new Error("reject requires a non-empty reason"), {
        status: 400,
      });
    }
    entry.reason = text;
  }

  const next = {
    updatedAt: shanghaiNow(),
    reviews: { ...(reviews.reviews || {}), [id]: entry },
  };
  fs.writeFileSync(
    path.join(dir, "reviews.json"),
    `${JSON.stringify(next, null, 2)}\n`,
  );
  return next;
}
