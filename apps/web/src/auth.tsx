import { useEffect, useRef, useState, type ReactNode } from "react";
import { RequestError, request, type User } from "@acceptances/api-client";
import { Alert } from "./components/reui/alert";
import { FormField } from "./components/reui/form-field";
import { Button } from "./components/ui/button";
import { FieldGroup, FieldSet } from "./components/ui/field";
import { Input } from "./components/ui/input";
import { Spinner } from "./components/ui/spinner";
import { message } from "./client";
import "./auth.css";

const authErrors: Record<string, string> = {
  LOGIN_FAILED: "用户名或密码不正确。",
  USERNAME_TAKEN: "这个用户名已被注册，请更换用户名或登录。",
  INVALID_CREDENTIALS_FORMAT:
    "请检查用户名格式，密码须至少 7 个字符且不超过 72 字节。",
  AUTH_RATE_LIMITED: "操作过于频繁，请稍后重试。",
};

export function AuthBoundary({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void request<User>("/auth/me")
      .then((value) => {
        if (active) {
          setUser(value);
          setError("");
        }
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof RequestError && error.status === 401)
          setUser(null);
        else setError(message(error));
      });
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    const expired = () => {
      setUser(null);
      setError("");
    };
    window.addEventListener("acceptances:unauthorized", expired);
    return () =>
      window.removeEventListener("acceptances:unauthorized", expired);
  }, []);
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await request("/auth/logout", "POST");
      setUser(null);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  if (user === undefined)
    return (
      <main className="auth-page">
        {error ? (
          <Alert role="alert">
            {error}
            <Button
              onClick={() => {
                setError("");
                setRevision((value) => value + 1);
              }}
            >
              重试连接
            </Button>
          </Alert>
        ) : (
          <p role="status">正在连接…</p>
        )}
      </main>
    );
  if (user === null) return <Login onSuccess={setUser} />;
  return (
    <div className="authenticated-workspace" key={user.id}>
      <header className="account-bar">
        <span>Acceptances · 团队工作台</span>
        <div className="flex items-center gap-3">
          <span>当前用户：{user.username}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void logout()}
          >
            {busy ? "正在退出…" : "退出登录"}
          </Button>
        </div>
      </header>
      {error && <Alert role="alert">{error}</Alert>}
      {children}
    </div>
  );
}

function Login({ onSuccess }: { onSuccess: (user: User) => void }) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  async function submit(form: HTMLFormElement) {
    if (submitting.current) return;
    const values = new FormData(form);
    if (register && values.get("password") !== values.get("confirm")) {
      setError("两次输入的密码不一致。");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ user: User }>(
        register ? "/auth/register" : "/auth/login",
        "POST",
        { username: values.get("username"), password: values.get("password") },
      );
      onSuccess(result.user);
    } catch (error) {
      setError(
        error instanceof RequestError && error.code
          ? authErrors[error.code] || message(error)
          : message(error),
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section
        className="auth-card"
        aria-label={register ? "注册账号" : "登录账号"}
      >
        <p className="muted">Acceptances</p>
        <h1>{register ? "注册团队账号" : "登录团队工作台"}</h1>
        <p className="muted">登录后可查看团队项目、创建需求并协作评审。</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit(event.currentTarget);
          }}
        >
          <FieldSet disabled={busy} className="m-0 min-w-0 border-0 p-0">
            <FieldGroup className="gap-4">
              <FormField
                id="auth-username"
                label="用户名"
                description={
                  register
                    ? "3–32 个字符，支持中文、字母、数字及 _ . -，英文不区分大小写。"
                    : undefined
                }
              >
                <Input
                  id="auth-username"
                  name="username"
                  required
                  minLength={register ? 3 : undefined}
                  maxLength={32}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </FormField>
              <FormField
                id="auth-password"
                label="密码"
                description={
                  register
                    ? "至少 7 个字符，不限制字符组合；不超过 72 字节。"
                    : undefined
                }
              >
                <Input
                  id="auth-password"
                  name="password"
                  type="password"
                  required
                  minLength={register ? 7 : undefined}
                  autoComplete={register ? "new-password" : "current-password"}
                />
              </FormField>
              {register && (
                <FormField id="auth-confirm" label="确认密码">
                  <Input
                    id="auth-confirm"
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                </FormField>
              )}
              <Button type="submit" variant="default">
                {busy && <Spinner aria-hidden="true" />}
                {busy ? "请稍候…" : register ? "注册并进入工作台" : "登录"}
              </Button>
            </FieldGroup>
          </FieldSet>
          {error && (
            <Alert variant="destructive" role="alert" className="mt-4">
              {error}
            </Alert>
          )}
        </form>
        <Button
          variant="ghost"
          className="mt-4"
          disabled={busy}
          onClick={() => {
            setRegister(!register);
            setError("");
          }}
        >
          {register ? "已有账号？返回登录" : "还没有账号？注册"}
        </Button>
      </section>
    </main>
  );
}
