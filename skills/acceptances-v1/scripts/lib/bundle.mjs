import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { cli, digest, fail, uuid } from "./local.mjs";

// Native JS key sorting and number encoding implement the same acceptances-jcs-1 golden vectors.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  if (typeof value === "number" && !Number.isFinite(value))
    fail("INVALID_ARGUMENT", "JCS 不接受非有限数值");
  const raw = JSON.stringify(value);
  if (raw === undefined) fail("INVALID_ARGUMENT", "JCS 不接受 undefined");
  return raw;
}
export function bundleFile(dir, path) {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          part.toLowerCase().startsWith(".env"),
      )
  )
    fail("PATH_INVALID", "bundle 路径无效或包含秘密文件");
  let file = dir;
  for (const part of path.split("/")) {
    file = join(file, part);
    if (lstatSync(file).isSymbolicLink())
      fail("PATH_INVALID", "bundle 不允许符号链接");
  }
  if (!lstatSync(file).isFile())
    fail("PATH_INVALID", "bundle 资产必须是普通文件");
  return file;
}
function readJSON(dir, path) {
  return JSON.parse(readFileSync(bundleFile(dir, path), "utf8"));
}
function bytes(dir, path) {
  const raw = readFileSync(bundleFile(dir, path));
  return { size: raw.length, sha256: digest(raw) };
}
export async function pack(config, directory, assetsFile) {
  const dir = resolve(directory);
  if (lstatSync(dir).isSymbolicLink())
    fail("PATH_INVALID", "bundle 目录不能是符号链接");
  if (existsSync(join(dir, "manifest.json")))
    return cli(config, ["validate", dir]);
  const documentsDir = join(dir, "documents");
  if (lstatSync(documentsDir).isSymbolicLink())
    fail("PATH_INVALID", "documents 不能是符号链接");
  const documents = readdirSync(documentsDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const doc = readJSON(dir, `documents/${name}`);
      if (
        name !== `${uuid(doc.id)}.json` ||
        !["definitions", "plan", "target"].includes(doc.kind) ||
        doc.projectId !== config.projectId
      )
        fail("REFERENCE_INVALID", "文档名称、类型或项目身份不匹配");
      return { id: doc.id, kind: doc.kind, doc };
    });
  for (const entry of documents.filter((d) => d.kind === "plan")) {
    let changed = false;
    for (const item of entry.doc.items) {
      for (const key of ["caseRef", "executionRef"]) {
        const definition = documents.find(
          (d) => d.kind === "definitions" && d.id === item[key].documentId,
        );
        if (!definition) fail("REFERENCE_INVALID", "pack 需要所有定义原文");
        const sha = bytes(dir, `documents/${definition.id}.json`).sha256;
        if (item[key].sha256 !== sha) changed = true;
        item[key].sha256 = sha;
      }
    }
    if (changed)
      writeFileSync(
        bundleFile(dir, `documents/${entry.id}.json`),
        JSON.stringify(entry.doc, null, 2) + "\n",
        { mode: 0o600 },
      );
  }
  const refs = documents
    .map(({ id, kind }) => ({
      id,
      kind,
      sha256: bytes(dir, `documents/${id}.json`).sha256,
    }))
    .sort((a, b) =>
      Buffer.compare(
        Buffer.from(`documents/${a.id}.json`),
        Buffer.from(`documents/${b.id}.json`),
      ),
    );
  const report = readJSON(dir, "report.json");
  if (report.projectId !== config.projectId)
    fail("REFERENCE_INVALID", "报告不属于关联项目");
  for (const key of ["planRef", "targetRef"]) {
    const ref = refs.find(
      (d) => d.id === report[key]?.id && d.kind === key.replace("Ref", ""),
    );
    if (!ref) fail("REFERENCE_INVALID", "报告缺少 Plan/Target 原文");
    report[key].sha256 = ref.sha256;
  }
  writeFileSync(
    bundleFile(dir, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  const descriptors = JSON.parse(readFileSync(assetsFile, "utf8"));
  if (!Array.isArray(descriptors))
    fail("INVALID_ARGUMENT", "资产描述必须是数组");
  const assets = [];
  for (const descriptor of descriptors) {
    const { id, path, kind, mediaType } = descriptor;
    uuid(id);
    if (!path.startsWith("assets/"))
      fail("PATH_INVALID", "证据必须位于 assets/");
    const file = bundleFile(dir, path),
      hash = createHash("sha256");
    let size = 0;
    for await (const chunk of createReadStream(file)) {
      size += chunk.length;
      hash.update(chunk);
    }
    assets.push({
      id,
      path,
      kind,
      mediaType,
      size,
      sha256: hash.digest("hex"),
    });
  }
  assets.sort((a, b) =>
    Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
  );
  const manifest = {
    schemaVersion: "1.0.0",
    kind: "manifest",
    id: uuid(report.id),
    projectId: config.projectId,
    runId: uuid(report.runId),
    report: { path: "report.json", ...bytes(dir, "report.json") },
    documents: refs,
    assets,
  };
  writeFileSync(join(dir, "manifest.json"), canonical(manifest), {
    mode: 0o600,
    flag: "wx",
  });
  try {
    return cli(config, ["validate", dir]);
  } catch (error) {
    // This manifest was created by this offline pack operation and has never been published.
    unlinkSync(join(dir, "manifest.json"));
    throw error;
  }
}
