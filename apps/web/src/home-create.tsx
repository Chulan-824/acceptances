import { FramePanel } from "./components/reui/frame";
import { Spinner } from "./components/ui/spinner";
import { Alert } from "./components/reui/alert";
import { Disclosure } from "./components/disclosure";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { FieldGroup } from "./components/ui/field";
import { FormField } from "./components/reui/form-field";
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
    <FramePanel asChild>
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
                <FieldGroup className="gap-4">
                  <FormField
                    id="home-name"
                    label={
                      <>
                        项目名称<span>必填</span>
                      </>
                    }
                    error={nameError}
                    description={
                      <span className="home-field-meta">
                        <span>最多 200 个字符</span>
                        <span>{name.length} / 200</span>
                      </span>
                    }
                  >
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
                  </FormField>
                  <FormField
                    id="home-description"
                    label={
                      <>
                        项目说明<span>选填</span>
                      </>
                    }
                  >
                    <Textarea
                      id="home-description"
                      name="description"
                      placeholder="简要说明被验收系统的业务范围或用途"
                    />
                  </FormField>
                </FieldGroup>
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
    </FramePanel>
  );
}
