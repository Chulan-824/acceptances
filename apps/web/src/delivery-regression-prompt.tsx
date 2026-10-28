import { useId, useState } from "react";
import type { Campaign } from "@acceptances/api-client";
import { toast } from "sonner";
import { buildDeliveryRegressionPrompt } from "./campaign-delivery-model";
import { Disclosure } from "./components/disclosure";
import { FormField } from "./components/reui/form-field";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";

export function DeliveryRegressionPrompt({ campaign }: { campaign: Campaign }) {
  const id = useId();
  const [prompt, setPrompt] = useState(() =>
    buildDeliveryRegressionPrompt(campaign, window.location.origin),
  );

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success("已复制全量回归提示词");
    } catch {
      toast.error("复制失败，请在文本框中手动选择并复制提示词");
    }
  }

  return (
    <Disclosure
      title="交付前全量回归提示词"
      className="mt-3 border-t border-border pt-3"
    >
      <div className="space-y-3 pt-3">
        <FormField
          id={id}
          label="回归提示词"
          description="已填入当前需求信息。修改【】内的浏览器、版本和环境等参数后，复制到业务代码目录的 Agent。"
        >
          <Textarea
            id={id}
            aria-describedby={`${id}-hint`}
            rows={14}
            className="resize-y"
            spellCheck={false}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </FormField>
        <Button
          size="sm"
          variant="outline"
          disabled={!prompt.trim()}
          onClick={() => void copyPrompt()}
        >
          复制提示词
        </Button>
      </div>
    </Disclosure>
  );
}
