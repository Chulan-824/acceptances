import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";

export const DIFF_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export const DIFF_PREVIEW_MAX_LINE_LENGTH = 20_000;
export const DIFF_PREVIEW_MAX_LINES = 30_000;

export type DiffEvidenceData = {
  text: string;
  files: FileDiffMetadata[];
  warning?: string;
};

export class DiffEvidenceError extends Error {
  kind: "load" | "limit";

  constructor(kind: "load" | "limit", message: string) {
    super(message);
    this.name = "DiffEvidenceError";
    this.kind = kind;
  }
}

export async function loadDiffEvidence(
  url: string,
  signal: AbortSignal,
): Promise<DiffEvidenceData> {
  signal.throwIfAborted();
  let text: string;
  try {
    const response = await fetch(url, { signal });
    if (!response.ok)
      throw new DiffEvidenceError(
        "load",
        `附件请求失败（${response.status}）。`,
      );
    const reader = response.body?.getReader();
    if (!reader) throw new DiffEvidenceError("load", "浏览器无法读取附件。");
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    const decoder = new TextDecoder();
    text = "";
    let bytes = 0;
    try {
      if (
        Number(response.headers.get("Content-Length")) > DIFF_PREVIEW_MAX_BYTES
      ) {
        await reader.cancel();
        throw new DiffEvidenceError(
          "limit",
          "附件超过 2 MiB 预览上限，请下载原文件查看。",
        );
      }
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > DIFF_PREVIEW_MAX_BYTES) {
          await reader.cancel();
          throw new DiffEvidenceError(
            "limit",
            "附件超过 2 MiB 预览上限，请下载原文件查看。",
          );
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      signal.removeEventListener("abort", cancel);
      reader.releaseLock();
    }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof DiffEvidenceError) throw error;
    throw new DiffEvidenceError("load", "附件加载失败，请重试。");
  }
  if (text.length === 0)
    return { text, files: [], warning: "附件为空，没有可预览的代码变更。" };
  const lines = text.split("\n");
  if (lines.length > DIFF_PREVIEW_MAX_LINES)
    throw new DiffEvidenceError(
      "limit",
      "附件超过 30,000 行预览上限，请下载查看。",
    );
  if (lines.some((line) => line.length > DIFF_PREVIEW_MAX_LINE_LENGTH))
    throw new DiffEvidenceError(
      "limit",
      "附件单行超过 20,000 字符预览上限，请下载查看。",
    );
  if (/^GIT binary patch\r?$/m.test(text))
    return {
      text,
      files: [],
      warning:
        "附件包含 Git 二进制补丁，无法完整展示代码差异，请查看原文或下载。",
    };
  try {
    const fileCount = assertPatchCoverage(text);
    const files = parsePatchFiles(text, undefined, true).flatMap(
      (patch) => patch.files,
    );
    if (
      files.length === 0 ||
      (fileCount !== undefined && files.length !== fileCount)
    )
      throw new Error("Missing file sections");
    return {
      text,
      files,
      warning: files.some((file) => file.hunks.length === 0)
        ? "包含二进制或仅元数据变更，这些文件没有可展示的代码行，请对照原文或下载查看。"
        : undefined,
    };
  } catch {
    return {
      text,
      files: [],
      warning:
        "无法识别完整补丁，可能是不支持的格式或内容不完整，请查看原文或下载。",
    };
  }
}

// Check declared hunk boundaries before handing content to the library, which
// can otherwise stop at a mail signature and silently ignore trailing changes.
function assertPatchCoverage(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  while (lines.at(-1) === "") lines.pop();
  const git = lines[0]?.startsWith("diff --git ");
  if (!git && !/^---[ \t]+\S/.test(lines[0] ?? ""))
    throw new Error("Unsupported patch wrapper");
  let inHunk = false;
  let headers = false;
  let fileCount = 0;
  let oldRemaining = 0;
  let newRemaining = 0;
  let effect = false;
  let from = false;
  let to = false;
  let oldMode = false;
  let newMode = false;
  const finishSection = () => {
    if (oldRemaining !== 0 || newRemaining !== 0)
      throw new Error("Incomplete hunk");
    if (!effect && !(from && to) && !(oldMode && newMode))
      throw new Error("Incomplete file section");
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inHunk) {
      if (line === "\\ No newline at end of file") continue;
      if (oldRemaining !== 0 || newRemaining !== 0) {
        if (line.startsWith("-")) oldRemaining--;
        else if (line.startsWith("+")) newRemaining--;
        else if (line.startsWith(" ")) {
          oldRemaining--;
          newRemaining--;
        } else throw new Error("Incomplete hunk");
        if (oldRemaining < 0 || newRemaining < 0)
          throw new Error("Excess hunk lines");
        continue;
      }
      inHunk = false;
    }
    if (git && line.startsWith("diff --git ")) {
      if (fileCount > 0) finishSection();
      fileCount++;
      inHunk = headers = effect = from = to = oldMode = newMode = false;
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(
      line,
    );
    if (hunk) {
      if (!headers) throw new Error("Missing file headers");
      if (
        !hunk
          .slice(1)
          .filter(Boolean)
          .every((value) => Number.isSafeInteger(Number(value)))
      )
        throw new Error("Unsupported hunk range");
      oldRemaining = Number(hunk[2] ?? 1);
      newRemaining = Number(hunk[4] ?? 1);
      inHunk = effect = true;
      continue;
    }
    if (
      /^---[ \t]+\S/.test(line) &&
      /^\+\+\+[ \t]+\S/.test(lines[i + 1] ?? "")
    ) {
      if (!git) {
        if (fileCount > 0) finishSection();
        fileCount++;
        effect = false;
      }
      headers = true;
      i++;
      continue;
    }
    effect ||=
      /^(?:Binary files .+ differ|(?:new file mode|deleted file mode) [0-7]{6})$/.test(
        line,
      );
    from ||= /^(?:rename|copy) from .+/.test(line);
    to ||= /^(?:rename|copy) to .+/.test(line);
    oldMode ||= /^old mode [0-7]{6}$/.test(line);
    newMode ||= /^new mode [0-7]{6}$/.test(line);
    if (
      git &&
      /^(?:index [\da-f]+\.\.[\da-f]+(?: [0-7]{6})?|(?:old mode|new mode|new file mode|deleted file mode) [0-7]{6}|(?:dis)?similarity index \d+%|(?:rename|copy) (?:from|to) .+|Binary files .+ differ)$/.test(
        line,
      )
    )
      continue;
    throw new Error("Unknown patch content");
  }
  finishSection();
  return fileCount;
}
