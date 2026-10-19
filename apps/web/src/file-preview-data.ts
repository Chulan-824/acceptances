export const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export const PREVIEW_PAGE_BYTES = 256 * 1024;
export const PREVIEW_MAX_LINES = 30_000;
export const PREVIEW_MAX_LINE_LENGTH = 20_000;

export class PreviewReadError extends Error {
  kind: "load" | "limit";
  constructor(kind: "load" | "limit", message: string) {
    super(message);
    this.name = "PreviewReadError";
    this.kind = kind;
  }
}

export type PreviewPage = {
  text: string;
  total: number;
  start: number;
  end: number;
  index: number;
};

// 即使服务器忽略 Range，也不能先下载完整文件再切片。
export async function readByteRange(
  url: string,
  start: number,
  end: number,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; total: number }> {
  signal.throwIfAborted();
  const response = await fetch(url, {
    signal,
    headers: { Range: `bytes=${start}-${end}` },
  });
  const fail = async (message: string, kind: "load" | "limit" = "load") => {
    await response.body?.cancel();
    throw new PreviewReadError(kind, message);
  };
  if (!response.ok) return fail(`附件请求失败（${response.status}）。`);
  const contentRange = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
    response.headers.get("Content-Range") || "",
  );
  let total: number | undefined;
  let expected: number | undefined;
  if (response.status === 206) {
    if (!contentRange) return fail("附件分段响应缺少有效的范围信息，请重试。");
    const [, from, to, size] = contentRange.map(Number);
    if (
      ![from, to, size].every(Number.isSafeInteger) ||
      from !== start ||
      to < from ||
      to > end ||
      size <= to ||
      to !== Math.min(end, size - 1)
    )
      return fail("附件分段响应与请求不一致，请重试。");
    total = size;
    expected = to - from + 1;
  } else if (response.status === 200) {
    if (start !== 0) return fail("服务器未支持分段读取，无法继续查看此文件。");
    const length = response.headers.get("Content-Length");
    if (length !== null) {
      total = Number(length);
      if (!Number.isSafeInteger(total) || total < 0)
        return fail("附件大小信息无效。");
      if (total > end + 1)
        return fail("服务器未支持分段读取，文件超过当前读取范围。", "limit");
      expected = total;
    }
  } else return fail("附件返回了不支持的分段响应。");
  const reader = response.body?.getReader();
  if (!reader) throw new PreviewReadError("load", "浏览器无法读取附件。");
  const chunks: Uint8Array[] = [];
  let count = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      count += part.value.byteLength;
      if (count > end - start + 1) {
        await reader.cancel();
        throw new PreviewReadError("limit", "附件响应超过分段读取范围。");
      }
      chunks.push(part.value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    if (signal.aborted) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (expected !== undefined && count !== expected)
    throw new PreviewReadError("load", "附件内容不完整，请重试。");
  const bytes = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, total: total ?? count };
}

export async function readPreviewPage(
  url: string,
  index: number,
  signal: AbortSignal,
): Promise<PreviewPage> {
  const start = index * PREVIEW_PAGE_BYTES;
  const { bytes, total } = await readByteRange(
    url,
    start,
    start + PREVIEW_PAGE_BYTES + 2,
    signal,
  );
  // 页边界向后对齐到 UTF-8 字符起点，前页包含完整字符，后页跳过续字节。
  const continuation = (position: number) => (bytes[position] & 0xc0) === 0x80;
  let from = 0;
  if (start > 0) while (from < bytes.length && continuation(from)) from++;
  let to = Math.min(PREVIEW_PAGE_BYTES, bytes.length);
  while (to < bytes.length && continuation(to)) to++;
  return {
    text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      bytes.subarray(from, to),
    ),
    total,
    start: start + from,
    end: start + to,
    index,
  };
}

export function richPreviewWarning(text: string): string | undefined {
  const lines = text.split("\n");
  if (
    lines.length > PREVIEW_MAX_LINES ||
    lines.some((line) => line.length > PREVIEW_MAX_LINE_LENGTH)
  )
    return "内容超过排版预览范围，已切换为分段原文。";
}

export async function loadFilePreview(
  url: string,
  rich: boolean,
  signal: AbortSignal,
) {
  const page = await readPreviewPage(url, 0, signal);
  if (!rich) return { page };
  if (page.total > PREVIEW_MAX_BYTES)
    return { page, warning: "文件较大，已切换为分段原文。" };
  let text = page.text;
  if (page.end !== page.total) {
    const complete = await readByteRange(url, 0, page.total - 1, signal);
    if (complete.total !== page.total)
      throw new PreviewReadError("load", "文件大小已变化，请关闭后重新打开。");
    text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(complete.bytes);
  }
  const warning = richPreviewWarning(text);
  return warning ? { page, warning } : { page, text };
}
