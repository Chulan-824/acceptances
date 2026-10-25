import { useRef, useState } from "react";
import type { Campaign } from "@acceptances/api-client";
import { request, message } from "./client";
import { Alert } from "./components/reui/alert";
import { FormField } from "./components/reui/form-field";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./components/ui/dialog";
import { FieldGroup, FieldSet } from "./components/ui/field";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Spinner } from "./components/ui/spinner";

export function CampaignCreate({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: (campaign: Campaign) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  async function create(form: HTMLFormElement) {
    if (submitting.current) return;
    const values = new FormData(form);
    const title = String(values.get("title") || "").trim();
    if (!title) {
      setError("请输入需求名称。");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const campaign = await request<Campaign>(
        `/projects/${projectId}/campaigns`,
        "POST",
        { title, description: values.get("description") },
      );
      setOpen(false);
      onCreated(campaign);
    } catch (error) {
      setError(message(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          setOpen(value);
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="mx-1 mb-3">
          创建需求
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={!busy}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>创建需求</DialogTitle>
          <DialogDescription>
            在当前项目下创建需求，后续可提交验证报告并交付测试。
          </DialogDescription>
        </DialogHeader>
        <form
          className="mt-6"
          onSubmit={(event) => {
            event.preventDefault();
            void create(event.currentTarget);
          }}
        >
          <FieldSet disabled={busy} className="m-0 min-w-0 border-0 p-0">
            <FieldGroup className="gap-4">
              <FormField id="campaign-title" label="需求名称">
                <Input
                  id="campaign-title"
                  name="title"
                  required
                  maxLength={200}
                />
              </FormField>
              <FormField id="campaign-description" label="需求说明（选填）">
                <Textarea id="campaign-description" name="description" />
              </FormField>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  取消
                </Button>
                <Button type="submit" variant="default">
                  {busy && <Spinner aria-hidden="true" />}
                  {busy ? "正在创建…" : "创建需求"}
                </Button>
              </DialogFooter>
            </FieldGroup>
          </FieldSet>
          {error && (
            <Alert variant="destructive" role="alert" className="mt-4">
              {error}
            </Alert>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
