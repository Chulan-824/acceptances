// 两个预览模块共用失败缓存清理和同源模块重试，避免浏览器复用失败的 import。
export function createPreviewModuleLoader<Module>(
  load: () => Promise<Module>,
  moduleName: "file-preview-viewer" | "diff-evidence-viewer",
) {
  let pending: Promise<Module> | undefined;
  let failedURL: URL | undefined;
  let sequence = 0;
  const path = new RegExp(
    `/(?:${moduleName}\\.tsx|${moduleName}-[A-Za-z0-9_-]+\\.js)$`,
  );
  return function loadModule(): Promise<Module> {
    if (!pending) {
      const retryURL = failedURL ? new URL(failedURL) : undefined;
      if (retryURL)
        retryURL.searchParams.set("preview-retry", String(++sequence));
      const loading = retryURL
        ? (import(/* @vite-ignore */ retryURL.href) as Promise<Module>)
        : load();
      pending = loading.catch((error: unknown) => {
        pending = undefined;
        if (error instanceof Error) {
          for (const match of error.message.matchAll(
            /https?:\/\/[^\s"'<>]+/g,
          )) {
            try {
              const candidate = new URL(match[0]);
              if (
                candidate.origin === window.location.origin &&
                !candidate.username &&
                !candidate.password &&
                path.test(candidate.pathname)
              )
                failedURL = candidate;
            } catch {
              /* 无法识别的模块错误保留刷新提示。 */
            }
          }
        }
        throw error;
      });
    }
    return pending;
  };
}
