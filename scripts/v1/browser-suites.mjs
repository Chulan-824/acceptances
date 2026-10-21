import { run as review } from "../../apps/web/tests/check-review-flow.mjs";
import { run as media } from "../../apps/web/tests/check-item-image-first.mjs";
import { run as preview } from "../../apps/web/tests/file-preview-real.mjs";
import { run as navigation } from "../../apps/web/tests/run-target-navigation.mjs";
import {
  run as refresh,
  scenarios as refreshCases,
} from "../../apps/web/tests/campaign-run-refresh.mjs";
import { run as lifecycle } from "../../apps/web/tests/campaign-run-real.mjs";
import {
  run as deletion,
  scenarios as deletionCases,
} from "../../apps/web/tests/deletion-flow.mjs";
import { run as deletionReal } from "../../apps/web/tests/deletion-real.mjs";
import { run as delivery, seed } from "../../apps/web/tests/delivery-real.mjs";
import { run as layout } from "../../apps/web/tests/report-layout.mjs";

const real = "real-browser-isolated-go-api";
const controlled = "real-browser-controlled-http";
const navigationCases = [
  "invalid",
  "repeat",
  "cross",
  "targets",
  "recovery",
  "loading",
  "stale",
  "failure",
  "deleted",
  "native",
  "missing-viewport",
  "refresh",
];
export const suites = {
  layout: {
    evidenceClass: real,
    run: ({ page, base, output }) => layout(page, base, output),
  },
  review: {
    evidenceClass: real,
    run: ({ page, base, output }) => review(page, base, output),
  },
  media: {
    evidenceClass: real,
    video: true,
    run: ({ page, base, output }) => media(page, base, output),
  },
  preview: {
    evidenceClass: real,
    run: ({ page, base, output, data }) => preview(page, base, output, data),
  },
  navigation: {
    evidenceClass: controlled,
    cases: navigationCases,
    run: ({ page, base, scenario }) => navigation(page, base, scenario),
  },
  refresh: {
    evidenceClass: controlled,
    cases: refreshCases,
    run: ({ page, base, scenario }) => refresh(page, base, scenario),
  },
  lifecycle: {
    evidenceClass: real,
    run: ({ page, base }) => lifecycle(page, base),
  },
  deletion: {
    evidenceClass: controlled,
    cases: deletionCases,
    run: ({ page, base, scenario }) => deletion(page, base, scenario),
  },
  "deletion-real": {
    evidenceClass: real,
    run: ({ page, base, data }) => deletionReal(page, base, data),
  },
  delivery: {
    evidenceClass: real,
    run: async ({ page, base, output }) =>
      delivery(page, base, output, await seed(base)),
  },
};

export function selectSuites(value = "all") {
  const names = value === "all" ? Object.keys(suites) : value.split(",");
  for (const name of names) {
    if (!Object.hasOwn(suites, name))
      throw new Error(
        `未知浏览器分组 ${name}；可用：${Object.keys(suites).join(",")}`,
      );
  }
  return [...new Set(names)];
}
