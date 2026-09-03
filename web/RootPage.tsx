import { url, useJson } from "./api";
import type { SubjectSummary } from "./types";

export function RootPage() {
  const root = new URLSearchParams(location.search).get("root") || "";
  const endpoint = url("/api/subjects", { root });
  const { data, error, loading } = useJson<{
    root: string;
    subjects: SubjectSummary[];
  }>(endpoint);

  return (
    <main className="page-narrow">
      <nav className="crumb">
        <a href="/">本地验收</a> / {root}
      </nav>
      <h1>Subjects</h1>
      <p className="muted path"><code>{root}</code></p>
      {loading ? <p className="muted">正在读取 Round…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {data?.subjects.map((subject) => (
        <section className="card" key={subject.name}>
          <h2>
            {subject.name}{" "}
            <a href={url("/subject", { root, subject: subject.name })}>打开验收主页</a>
          </h2>
          <ol>
            {subject.rounds.map((round) => (
              <li key={round.id}>
                <a
                  href={url("/subject", {
                    root,
                    subject: subject.name,
                    r: round.index,
                  })}
                >
                  第 {round.index} 轮 · {round.title}
                </a>{" "}
                <span className={`badge ${round.verdict || "unset"}`}>
                  {round.verdict || "无结论"}
                </span>{" "}
                <span className="muted">{round.createdAt || round.id}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </main>
  );
}
