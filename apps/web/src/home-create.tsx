import { Spinner } from "./components/ui/spinner";
import { Alert } from "./components/ui/alert";
import { Disclosure } from "./components/disclosure";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Label } from "./components/ui/label";
import { useRef, useState } from "react";
import type { Project } from "@acceptances/api-client";
import { message, request } from "./client";

export function HomeCreate({
  onCreated,
  open,
  setOpen,
}: {
  onCreated: (project: Project) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);

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
    <section className="home-create" aria-label="创建项目">
      <Disclosure
        className="home-create-panel"
        disabled={busy}
        triggerRef={toggle}
        open={open}
        onOpenChange={setOpen}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open && !busy) {
            event.preventDefault();
            setOpen(false);
            toggle.current?.focus();
          }
        }}
        title={
          <>
            <span>
              <span className="home-create-title">创建项目</span>
              <span className="home-create-description">
                添加被验收的产品或系统
              </span>
            </span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <path d="M5 12h14" />
              <path className="home-toggle-vertical" d="M12 5v14" />
            </svg>
          </>
        }
      >
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
              <Label htmlFor="home-name">
                项目名称<span>必填</span>
              </Label>
              <Input
                id="home-name"
                name="name"
                ref={nameInput}
                value={name}
                required
                maxLength={200}
                autoComplete="off"
                placeholder="请输入项目名称"
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
                <Alert
                  variant="destructive"
                  className="home-field-error"
                  role="alert"
                  id="home-name-error"
                >
                  {nameError}
                </Alert>
              )}
              <Label htmlFor="home-description">
                项目说明<span>选填</span>
              </Label>
              <Textarea
                id="home-description"
                name="description"
                placeholder="简要说明被验收系统的业务范围或用途"
              />
              <Button
                variant="default"
                className="home-create-submit"
                type="submit"
              >
                {busy && (
                  <Spinner
                    className="home-loading-spinner"
                    aria-hidden="true"
                  />
                )}
                {busy ? "正在创建…" : "创建项目"}
              </Button>
            </fieldset>
            {error && (
              <Alert
                variant="destructive"
                className="home-create-error"
                role="alert"
              >
                {error}
              </Alert>
            )}
          </form>
        </div>
      </Disclosure>
    </section>
  );
}
