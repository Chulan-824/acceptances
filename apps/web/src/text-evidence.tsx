import { useEffect, useState } from "react";

const previewLimit = 64 * 1024;

export function TextEvidence({ url }: { url: string }) {
  const [result, setResult] = useState<{
    url: string;
    text?: string;
    truncated?: boolean;
    error?: string;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`附件请求失败（${response.status}）`);
        const reader = response.body?.getReader();
        if (!reader) throw new Error("浏览器无法读取附件，请打开原文件。");
        const decoder = new TextDecoder();
        let text = "";
        let length = 0;
        let truncated = false;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            const available = previewLimit - length;
            text += decoder.decode(chunk.value.subarray(0, available), {
              stream: true,
            });
            length += chunk.value.byteLength;
            if (length > previewLimit) {
              truncated = true;
              await reader.cancel();
              break;
            }
          }
          text += decoder.decode();
        } finally {
          reader.releaseLock();
        }
        if (!controller.signal.aborted) setResult({ url, text, truncated });
      } catch (error) {
        if (!controller.signal.aborted)
          setResult({
            url,
            error: error instanceof Error ? error.message : "附件加载失败。",
          });
      }
    }
    void load();
    return () => controller.abort();
  }, [url]);
  if (result?.url !== url) return <p role="status">正在加载文本附件…</p>;
  if (result.error) return <p role="alert">{result.error}</p>;
  return (
    <>
      <pre className="text-evidence">{result.text || "文件为空。"}</pre>
      {result.truncated && (
        <p className="muted">
          仅预览前 64 KiB，完整内容请打开原文件或下载附件。
        </p>
      )}
    </>
  );
}
