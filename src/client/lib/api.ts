// Thin fetch wrapper for the /api endpoints. Throws ApiRequestError with the server's message.
import type { ApiErrorBody } from "../../shared/api";

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, key?: string | null): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (key) headers["authorization"] = `Bearer ${key}`;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiRequestError(0, "network", "Network error — check your connection.");
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const err = (json as ApiErrorBody | null)?.error;
    throw new ApiRequestError(res.status, err?.code ?? "http_error", err?.message ?? `Request failed (${res.status})`);
  }
  return json as T;
}
