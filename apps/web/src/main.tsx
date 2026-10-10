import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Project as ProjectData } from "@acceptances/api-client";
import { request, useResource, message, Load } from "./client";
import { Project } from "./project";
import "./style.css";
function App() {
  const [path, setPath] = useState(location.pathname);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { data, error: loadError } = useResource<{ items: ProjectData[] }>(
    "/projects",
    revision,
  );
  useEffect(() => {
    const pop = () => setPath(location.pathname);
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  function navigate(next: string) {
    history.pushState(null, "", next);
    setPath(next);
  }
  const parts = path.split("/").filter(Boolean);
  const project = parts[0] === "projects" ? parts[1] : undefined;
  async function create(form: HTMLFormElement) {
    const values = new FormData(form);
    setBusy(true);
    setError("");
    try {
      const item = await request<ProjectData>("/projects", "POST", {
        name: values.get("name"),
        description: values.get("description"),
      });
      setRevision((r) => r + 1);
      form.reset();
      navigate(`/projects/${item.id}`);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={project ? "app-shell" : "app-shell home-shell"}>
      <header className="app-header">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <span className="eyebrow">ACCEPTANCES · LOCAL</span>
          <h1>交付验证</h1>
        </a>
        <p>保存验证事实，查看证据，作出人工判断。</p>
      </header>
      <nav className="project-nav" aria-label="项目导航">
        <button onClick={() => navigate("/")}>所有项目</button>
        {data && (
          <select
            aria-label="当前项目"
            value={project || ""}
            onChange={(e) =>
              navigate(e.target.value ? `/projects/${e.target.value}` : "/")
            }
          >
            <option value="">选择项目</option>
            {data.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </nav>
      {project ? (
        <Project
          key={project}
          id={project}
          campaignId={parts[2] === "campaigns" ? parts[3] : undefined}
          runId={parts[4] === "runs" ? parts[5] : undefined}
          navigate={navigate}
          onDeleted={() => {
            setRevision((r) => r + 1);
            navigate("/");
          }}
        />
      ) : (
        <>
          <section>
            <h2>创建项目</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void create(e.currentTarget);
              }}
            >
              <label>
                项目名称
                <input name="name" required maxLength={200} />
              </label>
              <label>
                项目说明
                <textarea name="description" />
              </label>
              <button disabled={busy}>创建项目</button>
            </form>
            {error && <p role="alert">{error}</p>}
          </section>
          <section>
            <h2>项目</h2>
            {!data ? (
              <Load error={loadError} />
            ) : data.items.length ? (
              <div className="cards">
                {data.items.map((p) => (
                  <button
                    className="card"
                    key={p.id}
                    onClick={() => navigate(`/projects/${p.id}`)}
                  >
                    <strong>{p.name}</strong>
                    <span>{p.description || "暂无说明"}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p>
                创建第一个项目，然后在业务目录使用 skill 关联项目并提交验证。
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
