import { useEffect, useState } from "react";

export function url(path: string, values: Record<string, unknown> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || response.statusText);
  return body as T;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data as T;
}

export function useJson<T>(path: string, revision = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(path, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || response.statusText);
        setData(body as T);
        setError("");
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => controller.abort();
  }, [path, revision]);

  return { data, error, loading: !data && !error };
}
