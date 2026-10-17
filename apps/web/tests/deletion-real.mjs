// Real production Web + Go API. Fault injection only changes permissions in the
// caller's fresh temporary evidence directory; no HTTP responses are mocked.
import assert from "node:assert/strict";
import { chmod, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
export async function run(page, base, dataDir) {
  const origin = new URL(base);
  assert.equal(process.env.ACCEPTANCES_TEST_ISOLATED, "1");
  assert.equal(origin.hostname, "127.0.0.1");
  assert.ok(origin.port && origin.port !== "8765");
  assert.match(
    dataDir,
    /^\/(?:private\/)?tmp\/acceptances-deletion\.[^/]+\/data$/,
  );
  const api = async (path, method = "GET", data) => {
    const response = await page.request.fetch(`${base}/api/v1${path}`, {
      method,
      data,
    });
    assert.ok(
      response.ok(),
      `${method} ${path}: ${response.status()} ${await response.text()}`,
    );
    return response.status() === 204 ? undefined : response.json();
  };
  const results = [];
  for (const kind of ["project", "campaign", "run"]) {
    for (const cleanup of [false, true]) {
      const project = await api("/projects", "POST", {
        name: `真实删除-${kind}-${cleanup}`,
      });
      const campaign = await api(`/projects/${project.id}/campaigns`, "POST", {
        title: `真实需求-${kind}-${cleanup}`,
      });
      const report = {
        title: `真实报告-${kind}-${cleanup}`,
        description: "隔离合成数据",
        verifiedAt: new Date().toISOString(),
        scope: "删除行为",
        scopeType: "full",
        environment: "isolated-test",
        versions: [],
        checks: [
          {
            id: "one",
            title: "删除契约",
            expected: "按范围删除",
            actual: "合成测试",
            status: "passed",
            evidence: [],
          },
        ],
        evidence: [],
      };
      const uploaded = await page.request.post(
        `${base}/api/v1/campaigns/${campaign.id}/runs`,
        {
          multipart: {
            report: JSON.stringify(report),
            submissionId: project.id,
          },
        },
      );
      assert.equal(uploaded.status(), 201, await uploaded.text());
      const record = await uploaded.json();
      const path =
        kind === "project"
          ? `/projects/${project.id}`
          : `/projects/${project.id}/campaigns/${campaign.id}/runs/${record.id}`;
      const apiPath =
        kind === "project"
          ? `/projects/${project.id}`
          : kind === "campaign"
            ? `/campaigns/${campaign.id}`
            : `/runs/${record.id}`;
      const destination =
        kind === "project"
          ? "/"
          : kind === "campaign"
            ? `/projects/${project.id}`
            : `/projects/${project.id}/campaigns/${campaign.id}`;
      const label = { project: "项目", campaign: "需求", run: "验证记录" }[
        kind
      ];
      const name =
        kind === "project"
          ? project.name
          : kind === "campaign"
            ? campaign.title
            : report.title;
      await page.goto(base + path);
      if (kind === "campaign")
        await page
          .getByRole("button", { name: "需求操作", exact: true })
          .click();
      if (kind === "run")
        await page.getByRole("button", { name: /报告信息/ }).click();
      await page
        .getByRole(kind === "campaign" ? "menuitem" : "button", {
          name: `删除${label}`,
          exact: true,
        })
        .click();
      await page
        .getByRole("alertdialog")
        .getByText(/将永久删除/)
        .waitFor();
      const evidenceRoot = join(dataDir, "evidence"),
        orphan = join(evidenceRoot, record.id);
      if (cleanup) {
        await mkdir(orphan, { recursive: true });
        await chmod(evidenceRoot, 0o500);
      }
      try {
        const written = page.waitForResponse(
          (response) =>
            response.request().method() === "DELETE" &&
            response.url().endsWith(apiPath),
        );
        await page
          .getByRole("button", { name: "确认永久删除", exact: true })
          .click();
        const response = await written;
        assert.equal(response.status(), cleanup ? 500 : 204);
        if (cleanup)
          assert.equal((await response.json()).code, "EVIDENCE_CLEANUP_FAILED");
        await page.waitForURL(base + destination);
        if (cleanup)
          await page
            .getByText(`${label}“${name}”已删除，部分附件清理失败。`, {
              exact: false,
            })
            .waitFor();
        assert.equal(
          (await page.request.get(`${base}/api/v1${apiPath}`)).status(),
          404,
        );
        assert.equal(
          (await page.request.get(`${base}/api/v1/runs/${record.id}`)).status(),
          404,
        );
        if (kind === "run") {
          const current = await api(`/campaigns/${campaign.id}`);
          assert.equal(current.latestRunId, "");
          assert.equal(current.status, "pending");
          await page.getByText("暂无验证。", { exact: false }).waitFor();
        }
        if (kind === "campaign")
          assert.equal(
            (await api(`/projects/${project.id}/campaigns`)).items.length,
            0,
          );
        const dashboard = await api("/dashboard");
        if (kind === "run")
          assert.equal(
            dashboard.items.find((item) => item.id === campaign.id).latestRun,
            null,
          );
        else
          assert.ok(!dashboard.items.some((item) => item.id === campaign.id));
        if (cleanup) {
          await page.reload();
          await page.getByRole("heading").first().waitFor();
          assert.equal(
            await page.getByText(/已删除，部分附件清理失败/).count(),
            0,
          );
        }
        results.push({
          scenario: `${kind}/${cleanup ? "cleanup-failure" : "committed"}`,
          status: "passed",
          projectId: project.id,
          campaignId: campaign.id,
          runId: record.id,
          httpStatus: response.status(),
        });
      } finally {
        if (cleanup) {
          await chmod(evidenceRoot, 0o700);
          await rm(orphan, { recursive: true, force: true });
        }
      }
    }
  }
  return results;
}
