import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "@acceptances/api-client";
import "./style.css";

function App() {
  const [status, setStatus] = useState("正在连接 Go 服务…");
  useEffect(() => {
    const controller = new AbortController();
    void api
      .GET("/api/v1/capabilities", { signal: controller.signal })
      .then(({ data }) => {
        if (!controller.signal.aborted)
          setStatus(
            data
              ? `服务版本 ${data.version} · ${data.phase}`
              : "服务返回了异常响应",
          );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setStatus("暂时无法连接 Go 服务，请检查服务进程。");
      });
    return () => controller.abort();
  }, []);
  return (
    <main>
      <p className="eyebrow">ACCEPTANCES / V1</p>
      <h1>让交付有据可查。</h1>
      <p>工程基础已建立，业务能力尚未接入。</p>
      <p role="status">{status}</p>
      <section>
        <h2>当前阶段</h2>
        <p>
          Go 服务、CLI 与 React
          页面共用一个仓库。数据库迁移、证据发布、校验、封存及人工验收将在后续阶段实现。
        </p>
        <p>此页面不表示测试通过或服务已可用于验收。</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
