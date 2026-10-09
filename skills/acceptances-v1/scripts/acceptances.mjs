import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { API, chooseBasis } from "./lib/http.mjs";
import { pack, bundleFile } from "./lib/bundle.mjs";
import {
  cli,
  configPath,
  fail,
  git,
  load,
  locked,
  origin,
  outside,
  privateDir,
  save,
  stableId,
  token,
  uuid,
  workspace,
} from "./lib/local.mjs";

const commands = [
  "inspect",
  "connect",
  "prepare",
  "new-run",
  "snapshot",
  "pack",
  "deliver",
  "feedback",
];
export function parse(args) {
  const command = args.shift() || "help",
    options = {};
  while (args.length) {
    const key = args.shift();
    if (
      !key.startsWith("--") ||
      !args.length ||
      args[0].startsWith("--") ||
      key.slice(2) in options
    )
      fail("INVALID_ARGUMENT", "参数必须是 --名称 值，且不得重复");
    options[key.slice(2)] = args.shift();
  }
  const known = new Set([
    "repo",
    "config-dir",
    "project",
    "repository",
    "token-file",
    "acceptances-root",
    "url",
    "data-dir",
    "locator",
    "key",
    "title",
    "campaign",
    "bundle",
    "scope",
    "assets",
    "confirmed-basis",
    "reason",
  ]);
  for (const key of Object.keys(options))
    if (!known.has(key)) fail("INVALID_ARGUMENT", `未知参数 --${key}`);
  if (command !== "help" && !commands.includes(command))
    fail("INVALID_ARGUMENT", "未知命令");
  return { command, options };
}
function requireOption(options, key) {
  if (!options[key]?.trim()) fail("INVALID_ARGUMENT", `需要 --${key}`);
  return options[key].trim();
}
export async function run(args) {
  const { command, options } = parse([...args]);
  if (command === "help")
    return {
      commands,
      usage:
        "node <skill>/scripts/acceptances.mjs <command> --repo <business-repo> [options]",
      reference: "references/workflow.md",
    };
  const w = workspace(options.repo || process.cwd()),
    file = configPath(w, options);
  if (command === "inspect") {
    const config = load(w, options);
    return config
      ? { connected: true, configFile: file, ...config, root: w.root }
      : {
          connected: false,
          configFile: file,
          root: w.root,
          instructions:
            "在 Web 创建 Project token，保存仓库外 mode 600 文件；运行 connect。需要 repositories:write、definitions:write、campaigns:write、runs:write、evidence:write、results:read、feedback:read。",
        };
  }
  return locked(file, async () => {
    if (command === "connect") {
      const acceptancesRoot = realpathSync(
        resolve(requireOption(options, "acceptances-root")),
      );
      const tokenFile = resolve(requireOption(options, "token-file"));
      const dataDir = resolve(
        options["data-dir"] ||
          join(homedir(), ".local", "share", "acceptances", "runs", w.key),
      );
      outside(tokenFile, w.root);
      outside(dataDir, w.root);
      token(tokenFile);
      const existing = load(w, options);
      const projectId = uuid(requireOption(options, "project")),
        url = origin(options.url);
      if (
        existing &&
        (existing.projectId !== projectId || existing.url !== url)
      )
        fail(
          "LOCAL_CONFLICT",
          "已有不同项目或服务关联，请明确迁移关联后再配置",
        );
      const config = {
        schemaVersion: 1,
        gitCommonDir: w.common,
        projectId,
        tokenFile,
        url,
        cli: join(acceptancesRoot, "build", "acceptances"),
        contractsDir: join(acceptancesRoot, "contracts"),
        dataDir,
        repository: existing?.repository || null,
        campaigns: existing?.campaigns || {},
      };
      if (!existsSync(join(config.contractsDir, "schemas", "report.json")))
        fail("INVALID_ARGUMENT", "Acceptances V1 契约不存在");
      cli(config, ["version"]);
      if (
        !cli(config, ["help"]).commands?.some((entry) =>
          entry.startsWith("fingerprint "),
        )
      )
        fail(
          "CLI_UNAVAILABLE",
          "CLI 版本过旧，请在 Acceptances 源码目录运行 make build",
        );
      await new API(config).list(`/api/v1/projects/${projectId}/repositories`);
      save(file, config);
      return {
        connected: true,
        configFile: file,
        projectId,
        url,
        contractsDir: config.contractsDir,
      };
    }
    const config = load(w, options);
    if (!config)
      fail("SETUP_REQUIRED", "尚未关联项目，先 inspect 并完成 connect");
    const api =
      command === "pack" || command === "snapshot" || command === "new-run"
        ? null
        : new API(config);
    if (command === "prepare") {
      const key = requireOption(options, "key"),
        title = requireOption(options, "title");
      if (
        ["__proto__", "prototype", "constructor"].includes(key) ||
        key.length > 1024 ||
        /[\r\n]/.test(key)
      )
        fail("INVALID_ARGUMENT", "需求标识必须是稳定的单行标识");
      const locator =
        options.locator || config.repository?.locator || w.identityRoot;
      if (
        !locator.trim() ||
        /[\r\n]/.test(locator) ||
        /:\/\/[^/]*@/.test(locator)
      )
        fail("INVALID_ARGUMENT", "仓库地址不能包含凭据或换行");
      const repositories = await api.list(api.base + "/repositories");
      const matches = repositories.filter((r) => r.locator === locator);
      const selectedRepository = options.repository || config.repository?.id;
      const confirmedRepository =
        selectedRepository &&
        matches.find((entry) => entry.id === uuid(selectedRepository));
      if (options.repository && !confirmedRepository)
        fail("REFERENCE_INVALID", "选定仓库 ID 与地址不匹配");
      if (matches.length > 1 && !confirmedRepository)
        fail("AMBIGUOUS_REPOSITORY", "仓库地址匹配多个记录，请先人工确认", {
          candidates: matches.map(({ id, displayName, locator }) => ({
            id,
            displayName,
            locator,
          })),
        });
      const id =
        config.repository?.id ||
        stableId(`${config.projectId}/repository/${locator}`);
      if (config.repository && config.repository.locator !== locator)
        fail("LOCAL_CONFLICT", "已关联仓库地址不同");
      const repository =
        confirmedRepository ||
        matches[0] ||
        (
          await api.request(
            "POST",
            api.base + "/repositories",
            { id, displayName: basename(w.identityRoot), locator },
            { "Idempotency-Key": id },
          )
        ).data;
      config.repository = {
        id: uuid(repository.id),
        locator: repository.locator,
      };
      save(file, config);
      const campaigns = await api.list(api.base + "/campaigns");
      const candidates = campaigns.filter(
        (c) => c.externalRefs?.["acceptances/requirement"] === key,
      );
      const cached = config.campaigns[key];
      if (
        candidates.length > 1 &&
        !options.campaign &&
        !cached?.explicitlyLinked
      )
        fail("AMBIGUOUS_CAMPAIGN", "需求标识匹配多个活动，需人工选择", {
          candidates: candidates.map(({ id, title }) => ({ id, title })),
        });
      const selectedId =
        options.campaign ||
        (cached?.explicitlyLinked
          ? cached.id
          : candidates[0]?.id || cached?.id);
      let campaign;
      if (selectedId) {
        campaign = (
          await api.request("GET", `${api.base}/campaigns/${uuid(selectedId)}`)
        ).data;
        if (
          !options.campaign &&
          !config.campaigns[key]?.explicitlyLinked &&
          campaign.externalRefs?.["acceptances/requirement"] !== key
        )
          fail(
            "LOCAL_CONFLICT",
            "已有活动的需求关联不匹配；请升级服务或确认活动",
          );
      } else {
        const campaignId = stableId(`${config.projectId}/requirement/${key}`);
        campaign = (
          await api.request(
            "POST",
            api.base + "/campaigns",
            {
              id: campaignId,
              title,
              externalRefs: { "acceptances/requirement": key },
            },
            { "Idempotency-Key": campaignId },
          )
        ).data;
      }
      config.campaigns[key] = {
        ...(cached?.id === campaign.id ? cached : {}),
        id: uuid(campaign.id),
        title: campaign.title,
        explicitlyLinked: Boolean(
          options.campaign || config.campaigns[key]?.explicitlyLinked,
        ),
      };
      save(file, config);
      return {
        projectId: config.projectId,
        repository: config.repository,
        campaignId: campaign.id,
        requirementKey: key,
        contractsDir: config.contractsDir,
        reviewUrl: `${config.url}/projects/${config.projectId}/campaigns/${campaign.id}`,
        previousRun: config.campaigns[key].lastRun || null,
      };
    }
    const key = options.key,
      campaign = key && config.campaigns[key];
    if (command === "new-run") {
      if (!campaign || !config.repository)
        fail("SETUP_REQUIRED", "先 prepare 关联需求与仓库");
      const runId = randomUUID(),
        revisionId = randomUUID(),
        bundle = join(config.dataDir, campaign.id, runId);
      privateDir(bundle);
      mkdirSync(join(bundle, "documents"), { mode: 0o700 });
      mkdirSync(join(bundle, "assets"), { mode: 0o700 });
      const run = {
        projectId: config.projectId,
        repositoryId: config.repository.id,
        campaignId: campaign.id,
        runId,
        revisionId,
        bundle,
        startedAt: new Date().toISOString(),
        baseCommit: git(w.root, "rev-parse", "HEAD"),
        previousRun: campaign.lastRun || null,
      };
      save(join(bundle, "run.json"), run);
      return run;
    }
    if (command === "snapshot") {
      if (!config.repository) fail("SETUP_REQUIRED", "先 prepare");
      return cli(config, [
        "fingerprint",
        "--repo",
        w.root,
        "--repository",
        config.repository.id,
        "--base",
        git(w.root, "rev-parse", "HEAD"),
        "--scope",
        resolve(requireOption(options, "scope")),
      ]);
    }
    const bundle =
      command === "pack" || command === "deliver"
        ? resolve(requireOption(options, "bundle"))
        : null;
    if (command === "pack") {
      outside(bundle, w.root);
      return pack(config, bundle, resolve(requireOption(options, "assets")));
    }
    if (command === "feedback") {
      const campaignId = uuid(options.campaign || campaign?.id);
      return {
        feedback: cli(config, [
          "feedback",
          "--project",
          config.projectId,
          "--campaign",
          campaignId,
        ]),
        reviewUrl: `${config.url}/projects/${config.projectId}/campaigns/${campaignId}`,
      };
    }
    if (command === "deliver") {
      outside(bundle, w.root);
      // Validate before reading IDs or invoking a remote mutation.
      cli(config, ["validate", bundle]);
      const report = JSON.parse(
        readFileSync(bundleFile(bundle, "report.json"), "utf8"),
      );
      if (
        !campaign ||
        report.campaignId !== campaign.id ||
        report.projectId !== config.projectId
      )
        fail("REFERENCE_INVALID", "报告与本次需求或关联项目不匹配");
      const status = cli(config, ["publish", bundle, "--wait", "120s"]);
      if (status.phase !== "sealed")
        fail("PUBLICATION_PENDING", "报告尚未封存，先 status 查询");
      campaign.lastRun = {
        runId: report.runId,
        revisionId: report.id,
        bundle,
        results: report.results.map((r) => ({
          id: r.id,
          planItemId: r.planItemId,
        })),
        planId: report.planRef.id,
        targetId: report.targetRef.id,
      };
      save(file, config);
      const basis = await chooseBasis(
        api,
        report.campaignId,
        report.planRef.id,
        report.targetRef.id,
        options["confirmed-basis"],
        options["confirmed-basis"]
          ? requireOption(options, "reason")
          : "首次自动采用本次需求的验收依据",
      );
      const gate = async (mode) =>
        (
          await api.request(
            "GET",
            `${api.base}/campaigns/${report.campaignId}/gate?mode=${mode}&allowRisk=false`,
          )
        ).data;
      return {
        projectId: config.projectId,
        campaignId: report.campaignId,
        runId: report.runId,
        revisionId: report.id,
        publication: status,
        basis,
        ready: await gate("ready"),
        accepted: await gate("accepted"),
        reviewUrl: `${config.url}/projects/${config.projectId}/campaigns/${report.campaignId}`,
      };
    }
    fail("INVALID_ARGUMENT", "未知命令");
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  run(process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.log(
        JSON.stringify({
          error: {
            code: error.code || "LOCAL_ERROR",
            message: error.code
              ? error.message
              : "本地操作失败，请检查文件路径与格式",
            ...(error.data ? { details: error.data } : {}),
          },
        }),
      );
      process.exitCode = 1;
    });
}
