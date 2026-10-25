import type { DeletePreview } from "@acceptances/api-client";

export function DeletionPreviewContent({
  preview,
}: {
  preview: DeletePreview;
}) {
  return (
    <>
      将永久删除 {preview.projects} 个项目、{preview.campaigns} 个需求、
      {preview.runs} 次验证、{preview.evidence} 个附件、
      {preview.prdSnapshots ?? 0} 个 PRD 版本、{preview.prdFiles ?? 0} 个 PRD
      文件和 {preview.reviews} 条反馈。无法恢复。
      {(preview.retainedDeliveries ?? 0) > 0 && (
        <span className="block">
          保留 {preview.retainedDeliveries} 份交付快照及{" "}
          {preview.retainedDocuments ?? 0}{" "}
          份交付文档。对应交付将失效，仍可从交付版本查看历史及复制证据。
        </span>
      )}
    </>
  );
}
