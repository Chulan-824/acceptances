import { useRef, useState } from "react";
import type { Project } from "@acceptances/api-client";
import { message, request } from "./client";

function Icon({ name }: { name: "check" | "folder" | "arrow" | "toggle" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "check" && <path d="m5 12 4 4L19 6" />}
      {name === "folder" && (
        <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      )}
      {name === "arrow" && <path d="M5 12h14m-5-5 5 5-5 5" />}
      {name === "toggle" && (
        <>
          <path d="M5 12h14" />
          <path className="home-toggle-vertical" d="M12 5v14" />
        </>
      )}
    </svg>
  );
}

export function Home({
  projects,
  loadError,
  onRetry,
  navigate,
  onCreated,
}: {
  projects?: Project[];
  loadError?: string;
  onRetry: () => void;
  navigate: (path: string) => void;
  onCreated: (project: Project) => void;
}) {
  const [open, setOpen] = useState(true);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDetailsElement>(null);
  const submitting = useRef(false);

  function showCreate() {
    if (panel.current) panel.current.open = true;
    setOpen(true);
    nameInput.current?.focus();
  }

  async function create(form: HTMLFormElement) {
    if (submitting.current) return;
    setError("");
    const invalid = !name.trim()
      ? "请输入项目名称。"
      : name.length > 200
        ? "项目名称不能超过 200 个字符。"
        : "";
    setNameError(invalid);
    if (invalid) {
      nameInput.current?.focus();
      return;
    }
    const values = new FormData(form);
    submitting.current = true;
    setBusy(true);
    try {
      const item = await request<Project>("/projects", "POST", {
        name: values.get("name"),
        description: values.get("description"),
      });
      onCreated(item);
    } catch (error) {
      setError(message(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="home-page">
      <a className="home-skip" href="#home-content">
        跳到项目列表
      </a>
      <header className="home-header">
        <div className="home-container home-header-inner">
          <a className="home-brand" href="/">
            <span className="home-brand-mark">
              <Icon name="check" />
            </span>
            <span>Acceptances</span>
            <span className="home-brand-context">本机验收工具</span>
          </a>
          <a className="home-intro" href="/landing.html">
            产品介绍 <Icon name="arrow" />
          </a>
        </div>
      </header>
      <main
        className="home-container home-content"
        id="home-content"
        tabIndex={-1}
      >
        <div className="home-title">
          <h1>交付验证</h1>
          <p>保存验证事实，查看证据，作出人工判断。</p>
        </div>
        <div className="home-layout">
          <section
            className="home-projects"
            aria-labelledby="home-projects-title"
          >
            <div className="home-section-title">
              <h2 id="home-projects-title">项目</h2>
              <p>选择项目，查看其需求与验证记录。</p>
            </div>
            {!projects ? (
              <div className="home-state" aria-busy={!loadError}>
                {loadError ? (
                  <>
                    <h3>项目列表加载失败</h3>
                    <p role="alert">{loadError}</p>
                    <button type="button" onClick={onRetry}>
                      重新加载
                    </button>
                  </>
                ) : (
                  <p className="home-loading" role="status">
                    <span className="home-spinner" aria-hidden="true" />
                    正在加载项目…
                  </p>
                )}
              </div>
            ) : projects.length ? (
              <ul className="home-project-list" aria-label="项目列表">
                {projects.map((project) => (
                  <li key={project.id}>
                    <a
                      className="home-project-card"
                      href={`/projects/${project.id}`}
                      onClick={(event) => {
                        if (
                          event.button !== 0 ||
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey
                        )
                          return;
                        event.preventDefault();
                        navigate(`/projects/${project.id}`);
                      }}
                    >
                      <span className="home-project-icon">
                        <Icon name="folder" />
                      </span>
                      <span className="home-project-copy">
                        <strong className="home-project-name">
                          {project.name}
                        </strong>
                        <span className="home-project-description">
                          {project.description || "暂无说明"}
                        </span>
                        <span className="home-project-action">进入项目</span>
                      </span>
                      <Icon name="arrow" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="home-state">
                <span className="home-project-icon">
                  <Icon name="folder" />
                </span>
                <h3>还没有项目</h3>
                <p>
                  创建第一个项目，然后在业务目录使用 skill 关联项目并提交验证。
                </p>
                <button type="button" onClick={showCreate}>
                  填写项目名称 <Icon name="arrow" />
                </button>
              </div>
            )}
          </section>
          <section className="home-create" aria-label="创建项目">
            <details
              className="home-create-panel"
              ref={panel}
              open={open}
              onToggle={(event) => setOpen(event.currentTarget.open)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && open && !busy) {
                  event.preventDefault();
                  setOpen(false);
                  toggle.current?.focus();
                }
              }}
            >
              <summary
                ref={toggle}
                aria-disabled={busy || undefined}
                onClick={(event) => {
                  if (busy) event.preventDefault();
                }}
              >
                <span>
                  <span className="home-create-title">创建项目</span>
                  <span className="home-create-description">
                    添加一个待验收的产品或系统
                  </span>
                </span>
                <Icon name="toggle" />
              </summary>
              <div className="home-create-body">
                <form
                  noValidate
                  aria-busy={busy}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void create(event.currentTarget);
                  }}
                >
                  <fieldset disabled={busy}>
                    <label htmlFor="home-name">
                      项目名称<span>必填</span>
                    </label>
                    <input
                      id="home-name"
                      name="name"
                      ref={nameInput}
                      value={name}
                      required
                      maxLength={200}
                      autoComplete="off"
                      placeholder="输入项目名称"
                      aria-invalid={nameError ? true : undefined}
                      aria-describedby={
                        nameError
                          ? "home-name-hint home-name-error"
                          : "home-name-hint"
                      }
                      onChange={(event) => {
                        setName(event.target.value);
                        setNameError("");
                        setError("");
                      }}
                    />
                    <div className="home-field-meta" id="home-name-hint">
                      <span>最多 200 个字符</span>
                      <span>{name.length} / 200</span>
                    </div>
                    {nameError && (
                      <p
                        className="home-field-error"
                        role="alert"
                        id="home-name-error"
                      >
                        {nameError}
                      </p>
                    )}
                    <label htmlFor="home-description">
                      项目说明<span>选填</span>
                    </label>
                    <textarea
                      id="home-description"
                      name="description"
                      placeholder="简要说明项目用途"
                    />
                    <button
                      className="primary-button home-create-submit"
                      type="submit"
                    >
                      {busy && (
                        <span className="home-spinner" aria-hidden="true" />
                      )}
                      {busy ? "正在创建…" : "创建项目"}
                    </button>
                  </fieldset>
                  {error && (
                    <p className="home-create-error" role="alert">
                      {error}
                    </p>
                  )}
                </form>
              </div>
            </details>
          </section>
        </div>
        <footer className="home-footer">
          <span>Acceptances · 本机验收工具</span>
          <span>交付验证</span>
        </footer>
      </main>
    </div>
  );
}
