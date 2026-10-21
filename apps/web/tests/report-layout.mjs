// Reuses the report-centering check from the shadcn migration with isolated data.
import assert from "node:assert/strict";
import { join } from "node:path";
import { seed } from "./delivery-real.mjs";

export async function run(page, base, output) {
  const fixture = await seed(base);
  await page.goto(
    `${base}/projects/${fixture.project.id}/campaigns/${fixture.campaign.id}/runs/${fixture.run.id}`,
  );
  const summary = page.locator(".report-summary");
  const trigger = summary.locator(":scope > [data-slot=collapsible-trigger]");
  await summary.waitFor();
  const results = [];
  for (const width of [1120, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const collapsed of [false, true]) {
      if (collapsed) {
        await page
          .getByRole("button", { name: "收起需求列表", exact: true })
          .click();
        await page
          .getByRole("button", { name: "收起运行记录", exact: true })
          .click();
      }
      for (const expanded of [false, true]) {
        if ((await trigger.getAttribute("aria-expanded")) !== String(expanded))
          await trigger.click();
        await page.waitForFunction(() => {
          const summary = document
            .querySelector(".report-summary")
            .getBoundingClientRect();
          const version = document
            .querySelector(".report-version-line")
            .getBoundingClientRect();
          return (
            Math.abs(
              summary.x + summary.width / 2 - version.x - version.width / 2,
            ) <= 1
          );
        });
        const layout = await summary.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const trigger = element.querySelector(
            "[data-slot=collapsible-trigger]",
          );
          return {
            width: rect.width,
            maxWidth: getComputedStyle(element).maxWidth,
            marginTop: getComputedStyle(element).marginTop,
            display: getComputedStyle(trigger).display,
            align: getComputedStyle(trigger).alignItems,
          };
        });
        assert.ok(layout.width <= 897, JSON.stringify(layout));
        assert.equal(layout.maxWidth, "896px");
        assert.equal(layout.marginTop, "0px");
        assert.equal(layout.display, "flex");
        assert.equal(layout.align, "center");
        results.push({ width, collapsed, expanded, layout });
      }
      await page.screenshot({
        path: join(
          output,
          `${width}-${collapsed ? "collapsed" : "panels"}.png`,
        ),
        fullPage: true,
      });
      if (collapsed) {
        await page
          .getByRole("button", { name: "展开需求列表", exact: true })
          .click();
        await page
          .getByRole("button", { name: "展开运行记录", exact: true })
          .click();
      }
    }
  }
  return { results, fixture: "synthetic-platform-only" };
}
