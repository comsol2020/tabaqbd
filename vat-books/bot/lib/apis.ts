import { asJson } from "./disk.js";
import type { Kv } from "./store.js";

const APIS = "apis";
const ID_PATTERN = /^[a-z][a-z0-9_-]{0,40}$/;
const ENV_PATTERN = /^[A-Z][A-Z0-9_]{1,80}$/;

export type ApiEntry = {
  id: string;
  label: string;
  baseUrl: string;
  apiKeyEnv: string;
  note: string;
  createdAt: string;
};

export function normalizeBaseUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (url.username.length > 0 || url.password.length > 0) return undefined;
  if (url.search.length > 0 || url.hash.length > 0) return undefined;
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "http:" && !local) return undefined;
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

export function parseApiEntry(input: {
  id?: string;
  label?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  note?: string;
}): ApiEntry {
  const label = (input.label ?? "").trim();
  if (label.length === 0 || label.length > 80) {
    throw new Error("API label must be 1 to 80 characters.");
  }
  const idSource = (input.id ?? "").trim() || label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const id = idSource.slice(0, 41);
  if (!ID_PATTERN.test(id)) {
    throw new Error("API id must be lowercase letters, digits, _ or -, and start with a letter.");
  }
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? "");
  if (!baseUrl) {
    throw new Error("API base URL must be https, or http only on localhost. Do not put a key in the URL.");
  }
  const apiKeyEnv = (input.apiKeyEnv ?? "").trim();
  if (!ENV_PATTERN.test(apiKeyEnv) || apiKeyEnv.startsWith("CURSOR_")) {
    throw new Error("apiKeyEnv must be an uppercase env name and must not start with CURSOR_.");
  }
  const note = (input.note ?? "").trim().slice(0, 200);
  return {
    id,
    label,
    baseUrl,
    apiKeyEnv,
    note,
    createdAt: new Date().toISOString(),
  };
}

export async function listApis(kv: Kv): Promise<ApiEntry[]> {
  const value = await kv.get(APIS);
  if (!Array.isArray(value)) return [];
  return value.filter(isApiEntry);
}

export async function addApi(kv: Kv, input: Parameters<typeof parseApiEntry>[0]): Promise<ApiEntry> {
  const entry = parseApiEntry(input);
  const all = await listApis(kv);
  if (all.some((item) => item.id === entry.id)) {
    throw new Error(`API ${entry.id} is already registered. Remove it first to replace it.`);
  }
  await kv.put(APIS, asJson([...all, entry]));
  return entry;
}

export async function removeApi(kv: Kv, id: string): Promise<boolean> {
  const all = await listApis(kv);
  const next = all.filter((item) => item.id !== id);
  if (next.length === all.length) return false;
  await kv.put(APIS, asJson(next));
  return true;
}

function isApiEntry(value: unknown): value is ApiEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<ApiEntry>;
  return typeof row.id === "string" && typeof row.baseUrl === "string" && typeof row.apiKeyEnv === "string";
}
