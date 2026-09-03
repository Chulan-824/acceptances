export function shanghaiNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+08:00`;
}

export function shortStamp(value) {
  const text = String(value || "");
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (iso) return `${iso[2]}-${iso[3]} ${iso[4]}:${iso[5]}`;
  const dir = text.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  if (dir) return `${dir[2]}-${dir[3]} ${dir[4]}:${dir[5]}`;
  return text || "—";
}
