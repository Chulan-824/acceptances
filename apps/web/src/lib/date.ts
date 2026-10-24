import dayjs from "dayjs";

// API 时间戳按浏览器本地时区展示，保留原始值用于 dateTime 属性。
export function formatDateTime(
  value: string | null | undefined,
  format = "YYYY-MM-DD HH:mm:ss",
): string {
  if (!value) return "—";
  const date = dayjs(value);
  return date.isValid() ? date.format(format) : "—";
}
