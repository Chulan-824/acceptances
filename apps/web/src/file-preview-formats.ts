export function formatPreviewJSON(text: string): string {
  // 仅用 JSON.parse 校验语法，输出保留原始数字与字符串 token，避免大整数失真。
  JSON.parse(text);
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}[\],:]|[^\s{}[\],:]+/g) || [];
  const result: string[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "{" || token === "[") {
      if (++depth > 40) throw new Error("JSON 嵌套层级过深，请查看原文。");
      result.push(token);
      if (tokens[i + 1] !== "}" && tokens[i + 1] !== "]")
        result.push("\n", "  ".repeat(depth));
    } else if (token === "}" || token === "]") {
      depth--;
      if (tokens[i - 1] !== "{" && tokens[i - 1] !== "[")
        result.push("\n", "  ".repeat(depth));
      result.push(token);
    } else if (token === ",") result.push(",\n", "  ".repeat(depth));
    else if (token === ":") result.push(": ");
    else result.push(token);
  }
  return result.join("");
}

export function parsePreviewCSV(text: string): string[][] {
  if (!text) return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  let cells = 0;
  const pushField = () => {
    if (++cells > 20_000 || row.length >= 200)
      throw new Error("CSV 列数或单元格数量超过表格预览范围，请查看原文。");
    row.push(field);
    field = "";
    closed = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
    if (rows.length > 5_000)
      throw new Error("CSV 行数超过表格预览范围，请查看原文。");
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === ",") pushField();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (closed || char === '"')
        throw new Error("CSV 引号格式不正确，请查看原文。");
      field += char;
    }
  }
  if (quoted) throw new Error("CSV 引号未闭合，请查看原文。");
  if (field || row.length || closed || text.endsWith(",")) pushRow();
  return rows;
}

export type PreviewResource = { path: string; url: string };

export function resolvePreviewImage(
  src: string | undefined,
  resources: PreviewResource[],
) {
  if (!src || /^(?:[a-z][\w+.-]*:|\/|\\)/i.test(src)) return;
  try {
    const name = decodeURIComponent(src.replace(/^\.\//, ""));
    if (
      name.includes("/") ||
      name.includes("\\") ||
      !/\.(png|jpe?g|gif|webp)$/i.test(name)
    )
      return;
    return resources.find((item) => item.path === name)?.url;
  } catch {
    return;
  }
}
