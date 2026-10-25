import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ESLint } from "eslint";
import * as prettier from "prettier";

export async function checkStaged(cwd = process.cwd()) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
  git("diff", "--cached", "--check");
  const paths = git(
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMR",
    "-z",
  )
    .split("\0")
    .filter(Boolean);
  const eslint = new ESLint({ cwd });
  const formatter = await eslint.loadFormatter("stylish");
  let failed = false;
  for (const path of paths) {
    const filePath = resolve(cwd, path);
    const info = await prettier.getFileInfo(filePath, {
      ignorePath: resolve(cwd, ".prettierignore"),
    });
    const js =
      /\.(?:js|mjs|ts|tsx)$/.test(path) &&
      !(await eslint.isPathIgnored(filePath));
    const go = /^(?:cmd|internal|db)\/.*\.go$/.test(path);
    if ((!info.inferredParser || info.ignored) && !js && !go) continue;
    // Read the index so partial staging never checks or rewrites unstaged edits.
    const source = git("show", `:${path}`);
    if (info.inferredParser && !info.ignored) {
      const formatted = await prettier.format(source, {
        ...(await prettier.resolveConfig(filePath)),
        filepath: filePath,
      });
      if (formatted !== source) {
        console.error(`格式不符: ${path}（请格式化后重新暂存）`);
        failed = true;
      }
    }
    if (js) {
      const results = await eslint.lintText(source, { filePath });
      if (results.some((result) => result.errorCount || result.warningCount)) {
        console.error(formatter.format(results));
        failed = true;
      }
    }
    if (
      go &&
      execFileSync("gofmt", [], { input: source, encoding: "utf8" }) !== source
    ) {
      console.error(`gofmt 不符: ${path}（请格式化后重新暂存）`);
      failed = true;
    }
  }
  if (failed) throw new Error("暂存检查失败，未修改工作区或暂存区");
  console.log(`暂存检查通过（${paths.length} 个文件；未运行构建或数据库测试）`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await checkStaged();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
