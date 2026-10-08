import { useEffect, useState } from "react";
import {
  api,
  readPages,
  mutationHeaders,
  record,
  text,
  errorMessage,
  type RecordValue,
} from "./client";
import { Campaign } from "./campaign";
const scopes = [
  "definitions:write",
  "campaigns:write",
  "runs:write",
  "evidence:write",
  "results:read",
  "feedback:read",
  "evidence:read",
] as const;
export function Project({
  project,
  campaign,
  onCampaign: setCampaign,
}: {
  project: string;
  campaign: string;
  onCampaign: (id: string) => void;
}) {
  const [repositories, setRepositories] = useState<RecordValue[]>([]);
  const [campaigns, setCampaigns] = useState<RecordValue[]>([]);
  const [tokens, setTokens] = useState<RecordValue[]>([]);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([
      readPages((cursor) =>
        api.GET("/api/v1/projects/{projectId}/repositories", {
          params: { path: { projectId: project }, query: { cursor } },
        }),
      ),
      readPages((cursor) =>
        api.GET("/api/v1/projects/{projectId}/campaigns", {
          params: { path: { projectId: project }, query: { cursor } },
        }),
      ),
      readPages((cursor) =>
        api.GET("/api/v1/projects/{projectId}/tokens", {
          params: { path: { projectId: project }, query: { cursor } },
        }),
      ),
    ])
      .then(([r, c, t]) => {
        if (!active) return;
        setRepositories(r);
        setCampaigns(c);
        setTokens(t);
      })
      .catch(() => {
        if (active) setError("项目数据无法读取。");
      });
    return () => {
      active = false;
    };
  }, [project]);
  async function createRepository(form: FormData) {
    setBusy(true);
    try {
      const { data, error } = await api.POST(
        "/api/v1/projects/{projectId}/repositories",
        {
          params: { path: { projectId: project }, header: mutationHeaders() },
          body: {
            id: crypto.randomUUID(),
            displayName: String(form.get("name")),
            locator: String(form.get("locator")),
          },
        },
      );
      if (error) setError(errorMessage(error));
      else if (data) setRepositories([...repositories, record(data.data)]);
    } catch {
      setError("登记失败。");
    } finally {
      setBusy(false);
    }
  }
  async function createCampaign(form: FormData) {
    setBusy(true);
    try {
      const { data, error } = await api.POST(
        "/api/v1/projects/{projectId}/campaigns",
        {
          params: { path: { projectId: project }, header: mutationHeaders() },
          body: {
            id: crypto.randomUUID(),
            title: String(form.get("title")),
            externalRefs: {},
          },
        },
      );
      if (error) setError(errorMessage(error));
      else if (data) {
        const c = record(data.data);
        setCampaigns([...campaigns, c]);
        setCampaign(text(c.id));
      }
    } catch {
      setError("创建交付失败。");
    } finally {
      setBusy(false);
    }
  }
  async function createToken(form: FormData) {
    setBusy(true);
    setSecret("");
    const selected = scopes.filter((s) => form.getAll("scope").includes(s));
    try {
      const { data, error } = await api.POST(
        "/api/v1/projects/{projectId}/tokens",
        {
          params: { path: { projectId: project }, header: mutationHeaders() },
          body: {
            id: crypto.randomUUID(),
            name: String(form.get("name")),
            scopes: selected,
            ...(form.get("long") ? { expiresAt: null } : {}),
          },
        },
      );
      if (error) setError(errorMessage(error));
      else if (data) {
        const token = record(data.data);
        setSecret(text(token.secret));
        const summary = { ...token };
        delete summary.secret;
        setTokens([...tokens, summary]);
      }
    } catch {
      setError("创建 token 失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="muted">
        Project <code>{project}</code>
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="columns">
        <section>
          <h2>代码仓库</h2>
          {repositories.map((r) => (
            <p key={text(r.id)}>
              {text(r.displayName)}
              <br />
              <code>{text(r.id)}</code>
            </p>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createRepository(new FormData(e.currentTarget));
            }}
          >
            <label>
              仓库名称
              <input name="name" required />
            </label>
            <label>
              仓库地址
              <input name="locator" placeholder="Git URL 或本地路径" required />
            </label>
            <button disabled={busy}>登记仓库</button>
          </form>
        </section>
        <section>
          <h2>Agent token</h2>
          <p>用于该项目的结果与证据上报，不能替你人审。</p>
          {tokens.map((t) => (
            <p key={text(t.id)}>
              {text(t.name)}{" "}
              {t.revokedAt ? (
                "已撤销"
              ) : (
                <button
                  disabled={busy}
                  onClick={() => {
                    void api
                      .DELETE("/api/v1/projects/{projectId}/tokens/{tokenId}", {
                        params: {
                          path: { projectId: project, tokenId: text(t.id) },
                          header: mutationHeaders(),
                        },
                      })
                      .then(({ error }) => {
                        if (error) setError(errorMessage(error));
                        else
                          setTokens(
                            tokens.map((x) =>
                              x.id === t.id
                                ? { ...x, revokedAt: new Date().toISOString() }
                                : x,
                            ),
                          );
                      });
                  }}
                >
                  撤销
                </button>
              )}
            </p>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createToken(new FormData(e.currentTarget));
            }}
          >
            <label>
              名称
              <input name="name" required />
            </label>
            <fieldset>
              <legend>项目权限</legend>
              {scopes.map((scope) => (
                <label className="inline" key={scope}>
                  <input
                    type="checkbox"
                    name="scope"
                    value={scope}
                    defaultChecked={scope !== "evidence:read"}
                  />
                  {scope}
                </label>
              ))}
            </fieldset>
            <label className="inline">
              <input type="checkbox" name="long" />
              明确使用长期 token。默认有效期 90 天。
            </label>
            <button disabled={busy}>创建 token</button>
          </form>
          {secret && (
            <aside>
              <p>秘密只展示这一次，请保存到仓库外受限文件。</p>
              <textarea readOnly aria-label="新 token" value={secret} />
              <button onClick={() => setSecret("")}>隐藏秘密</button>
            </aside>
          )}
        </section>
      </div>
      <section>
        <h2>交付活动</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void createCampaign(new FormData(e.currentTarget));
          }}
        >
          <input
            name="title"
            aria-label="交付标题"
            placeholder="本次需求的交付标题"
            required
          />
          <button disabled={busy}>创建交付</button>
        </form>
        <ul>
          {campaigns.map((c) => (
            <li key={text(c.id)}>
              <button onClick={() => setCampaign(text(c.id))}>
                {text(c.title)}
              </button>{" "}
              <code>{text(c.id)}</code>
            </li>
          ))}
        </ul>
      </section>
      {campaign && (
        <Campaign key={campaign} project={project} campaign={campaign} />
      )}
    </>
  );
}
