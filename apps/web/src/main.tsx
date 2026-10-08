import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  api,
  readPages,
  mutationHeaders,
  setCSRF,
  record,
  text,
  errorMessage,
  type RecordValue,
} from "./client";
import { Run } from "./run";
import { Project } from "./project";
import "./style.css";

function App() {
  const [user, setUser] = useState("");
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const expire = () => setExpired(true);
    window.addEventListener("acceptances:session-expired", expire);
    return () =>
      window.removeEventListener("acceptances:session-expired", expire);
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<RecordValue[]>([]);
  const [path, setPath] = useState(location.pathname);
  const parts = path.split("/").filter(Boolean);
  const project = parts[0] === "projects" ? parts[1] || "" : "";
  const campaign = parts[2] === "campaigns" ? parts[3] || "" : "";
  const run = parts[2] === "runs" ? parts[3] || "" : "";
  const revision = parts[4] === "revisions" ? parts[5] || "" : "";
  function navigate(path: string) {
    history.pushState(null, "", path);
    setPath(path);
  }
  function setProject(id: string) {
    navigate(id ? `/projects/${id}` : "/projects");
  }
  useEffect(() => {
    const pop = () => setPath(location.pathname);
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void api
      .GET("/api/v1/session")
      .then(({ data }) => {
        if (!active) return;
        if (data) {
          const session = record(data.data);
          setUser(text(session.username));
          setCSRF(text(session.csrfToken));
        }
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setError("服务无法连接。");
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    let active = true;
    void readPages((cursor) =>
      api.GET("/api/v1/projects", { params: { query: { cursor } } }),
    )
      .then((items) => {
        if (active) setProjects(items);
      })
      .catch((error: Error) => {
        if (active) setError(error.message);
      });
    let lastActivity = 0;
    const onClick = () => {
      if (Date.now() - lastActivity < 5 * 60 * 1000) return;
      lastActivity = Date.now();
      void api
        .POST("/api/v1/session/activity", {
          params: { header: mutationHeaders() },
          body: {},
        })
        .catch(() => {});
    };
    window.addEventListener("pointerdown", onClick);
    window.addEventListener("keydown", onClick);
    return () => {
      active = false;
      window.removeEventListener("pointerdown", onClick);
      window.removeEventListener("keydown", onClick);
    };
  }, [user]);
  async function login(form: FormData) {
    setBusy(true);
    setError("");
    const username = String(form.get("username") || "");
    try {
      const { data, error } = await api.POST("/api/v1/session", {
        body: { username, password: String(form.get("password") || "") },
      });
      if (error) setError(errorMessage(error));
      else if (data) {
        setCSRF(text(record(data.data).csrfToken));
        setUser(username);
        setExpired(false);
      }
    } catch {
      setError("登录服务无法连接。");
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { data, error } = await api.POST("/api/v1/projects", {
        params: { header: mutationHeaders() },
        body: { id: crypto.randomUUID(), name },
      });
      if (error) setError(errorMessage(error));
      else if (data) {
        const p = record(data.data);
        setProjects([...projects, p]);
        setProject(text(p.id));
        setName("");
      }
    } catch {
      setError("创建项目失败。");
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main>
        <p role="status">正在确认会话…</p>
      </main>
    );
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">ACCEPTANCES</p>
          <h1>交付验收</h1>
        </div>
        {user && (
          <button
            onClick={() => {
              void api
                .DELETE("/api/v1/session", {
                  params: { header: mutationHeaders() },
                })
                .then(({ error }) => {
                  if (error) {
                    setError(errorMessage(error));
                    return;
                  }
                  setCSRF("");
                  setUser("");
                  setProject("");
                })
                .catch(() => setError("退出失败，请重试。"));
            }}
          >
            退出 {user}
          </button>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {expired && user && (
        <p role="alert">
          会话已过期，当前视图与输入已保留；请重新登录后刷新依据。
        </p>
      )}
      {(!user || expired) && (
        <section>
          <h2>所有者登录</h2>
          <p>首次使用须先执行数据库迁移和所有者初始化。</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              void login(new FormData(form)).finally(() => form.reset());
            }}
          >
            <label>
              用户名
              <input name="username" autoComplete="username" required />
            </label>
            <label>
              密码
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <button disabled={busy}>登录</button>
          </form>
        </section>
      )}
      {user && (
        <fieldset disabled={expired}>
          <nav>
            <label>
              当前项目
              <select
                value={project}
                onChange={(e) => setProject(e.target.value)}
              >
                <option value="">选择项目</option>
                {projects.map((p) => (
                  <option key={text(p.id)} value={text(p.id)}>
                    {text(p.name)}
                  </option>
                ))}
              </select>
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <input
                aria-label="新项目名称"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="新项目名称"
                required
              />
              <button disabled={busy}>创建项目</button>
            </form>
          </nav>
          {project ? (
            run ? (
              <Run
                key={run}
                project={project}
                run={run}
                revision={revision}
                navigate={navigate}
              />
            ) : (
              <Project
                key={project}
                project={project}
                campaign={campaign}
                onCampaign={(id) =>
                  navigate(`/projects/${project}/campaigns/${id}`)
                }
              />
            )
          ) : (
            <p>创建或选择项目，然后登记代码仓库与交付活动。</p>
          )}
        </fieldset>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
