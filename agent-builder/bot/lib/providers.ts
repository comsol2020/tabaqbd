export const MAX_MESSAGES = 32;
export const MAX_MESSAGE_CHARS = 16_000;
export const MAX_OUTPUT_TOKENS = 4_096;
export const DEFAULT_MAX_TOKENS = 1_024;
export const REQUEST_TIMEOUT_MS = 60_000;

const DEFAULT_BASE_URL = "https://api.maiarouter.ai/v1";
const DEFAULT_MODEL = "maia/gemini-2.5-flash";
const ID_PATTERN = /^[a-z][a-z0-9_-]{0,40}$/;
const ENV_PATTERN = /^[A-Z][A-Z0-9_]{1,80}$/;

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ProviderDefinition = {
  id: string;
  label: string;
  protocol: "openai-compatible";
  baseUrl: string;
  apiKeyEnv: string;
  defaultModel: string;
};

export type ProviderView = {
  id: string;
  label: string;
  protocol: "openai-compatible";
  configured: boolean;
  apiKeyEnv: string;
  defaultModel: string;
  baseUrl: string;
  baseHost: string;
};

export type ProviderCatalog = {
  defaultProviderId: "miarouter";
  providers: ProviderView[];
  ignored: Array<{ reason: string }>;
};

export type CompletionRequest = {
  providerId?: string;
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
};

export type CompletionResult =
  | {
      ok: true;
      providerId: string;
      model: string;
      content: string;
      finishReason: string | null;
      usage: {
        promptTokens: number | null;
        completionTokens: number | null;
      };
    }
  | {
      ok: false;
      error:
        | "unknown_provider"
        | "missing_api_key"
        | "invalid_request"
        | "upstream_error";
      message: string;
      providerId?: string;
      apiKeyEnv?: string;
      status?: number;
    };

type Env = Record<string, string | undefined>;

export function loadCatalog(env: Env = process.env): ProviderCatalog {
  const ignored: Array<{ reason: string }> = [];
  const miarouter = miarouterDefinition(env, ignored);
  const extras = extraDefinitions(env, ignored);
  const definitions = [miarouter, ...extras];
  return {
    defaultProviderId: "miarouter",
    providers: definitions.map((definition) => toView(definition, env)),
    ignored,
  };
}

export async function completeChat(
  request: CompletionRequest,
  env: Env = process.env,
): Promise<CompletionResult> {
  const catalog = loadDefinitions(env);
  const providerId = request.providerId ?? "miarouter";
  const provider = catalog.definitions.find((item) => item.id === providerId);
  if (provider === undefined) {
    const known = catalog.definitions.map((item) => item.id).join(", ");
    return {
      ok: false,
      error: "unknown_provider",
      providerId,
      message: `Unknown provider. Configured ids: ${known}.`,
    };
  }

  const invalid = validateRequest(request);
  if (invalid !== undefined) {
    return {
      ok: false,
      error: "invalid_request",
      providerId: provider.id,
      message: invalid,
    };
  }

  const apiKey = env[provider.apiKeyEnv]?.trim() ?? "";
  if (apiKey.length === 0) {
    return {
      ok: false,
      error: "missing_api_key",
      providerId: provider.id,
      apiKeyEnv: provider.apiKeyEnv,
      message: `Set ${provider.apiKeyEnv} to call ${provider.label}.`,
    };
  }

  const model = request.model?.trim() || provider.defaultModel;
  const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;
  const body: {
    model: string;
    messages: ChatMessage[];
    max_tokens: number;
    temperature?: number;
  } = {
    model,
    messages: request.messages,
    max_tokens: maxTokens,
  };
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }

  let response: Response;
  try {
    response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      error: "upstream_error",
      providerId: provider.id,
      message: redact(errorText(error), apiKey),
    };
  }

  const raw = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      error: "upstream_error",
      providerId: provider.id,
      status: response.status,
      message: redact(raw.slice(0, 400), apiKey) || `HTTP ${response.status}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {
      ok: false,
      error: "upstream_error",
      providerId: provider.id,
      status: response.status,
      message: "Upstream returned a non-JSON body.",
    };
  }

  const content = readContent(parsed);
  if (content === undefined) {
    return {
      ok: false,
      error: "upstream_error",
      providerId: provider.id,
      status: response.status,
      message: "Upstream response did not include a message.",
    };
  }

  return {
    ok: true,
    providerId: provider.id,
    model: readModel(parsed) ?? model,
    content,
    finishReason: readFinishReason(parsed),
    usage: readUsage(parsed),
  };
}

function loadDefinitions(env: Env): {
  definitions: ProviderDefinition[];
  ignored: Array<{ reason: string }>;
} {
  const ignored: Array<{ reason: string }> = [];
  return {
    definitions: [
      miarouterDefinition(env, ignored),
      ...extraDefinitions(env, ignored),
    ],
    ignored,
  };
}

function miarouterDefinition(
  env: Env,
  ignored: Array<{ reason: string }>,
): ProviderDefinition {
  const configured = env.MIAROUTER_BASE_URL?.trim() ?? "";
  const normalized =
    configured.length > 0 ? normalizeBaseUrl(configured) : undefined;
  if (configured.length > 0 && normalized === undefined) {
    ignored.push({
      reason: "MIAROUTER_BASE_URL is not a usable http(s) URL. Using the default host.",
    });
  }
  const model = env.MIAROUTER_DEFAULT_MODEL?.trim() || DEFAULT_MODEL;
  return {
    id: "miarouter",
    label: "Miarouter",
    protocol: "openai-compatible",
    baseUrl: normalized ?? DEFAULT_BASE_URL,
    apiKeyEnv: "MIAROUTER_API_KEY",
    defaultModel: model.slice(0, 200),
  };
}

function extraDefinitions(
  env: Env,
  ignored: Array<{ reason: string }>,
): ProviderDefinition[] {
  const raw = env.EXTRA_PROVIDERS_JSON?.trim() ?? "";
  if (raw.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    ignored.push({ reason: "EXTRA_PROVIDERS_JSON is not valid JSON." });
    return [];
  }
  if (!Array.isArray(parsed)) {
    ignored.push({ reason: "EXTRA_PROVIDERS_JSON must be an array." });
    return [];
  }

  const definitions: ProviderDefinition[] = [];
  const seen = new Set<string>(["miarouter"]);
  for (const entry of parsed) {
    const definition = readExtra(entry, seen, ignored);
    if (definition !== undefined) {
      seen.add(definition.id);
      definitions.push(definition);
    }
  }
  return definitions;
}

function readExtra(
  entry: unknown,
  seen: Set<string>,
  ignored: Array<{ reason: string }>,
): ProviderDefinition | undefined {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    ignored.push({ reason: "Skipped an extra provider that is not an object." });
    return undefined;
  }
  const record = entry as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  if (!ID_PATTERN.test(id)) {
    ignored.push({ reason: "Skipped an extra provider with an invalid id." });
    return undefined;
  }
  if (seen.has(id)) {
    ignored.push({ reason: `Skipped duplicate provider ${id}.` });
    return undefined;
  }
  if (record.protocol !== "openai-compatible") {
    ignored.push({
      reason: `Skipped ${id}: only openai-compatible is built in. Add another protocol in bot/lib/providers.ts.`,
    });
    return undefined;
  }
  const baseUrl =
    typeof record.baseUrl === "string" ? normalizeBaseUrl(record.baseUrl) : undefined;
  if (baseUrl === undefined) {
    ignored.push({ reason: `Skipped ${id}: baseUrl must be https, or http on localhost.` });
    return undefined;
  }
  if (!isApiKeyEnv(record.apiKeyEnv)) {
    ignored.push({
      reason: `Skipped ${id}: apiKeyEnv must be an uppercase env name and must not start with CURSOR_.`,
    });
    return undefined;
  }
  const defaultModel =
    typeof record.defaultModel === "string" ? record.defaultModel.trim() : "";
  if (defaultModel.length === 0 || defaultModel.length > 200) {
    ignored.push({ reason: `Skipped ${id}: defaultModel is missing.` });
    return undefined;
  }
  const label =
    typeof record.label === "string" && record.label.trim().length > 0
      ? record.label.trim().slice(0, 80)
      : id;
  return {
    id,
    label,
    protocol: "openai-compatible",
    baseUrl,
    apiKeyEnv: record.apiKeyEnv,
    defaultModel,
  };
}

function toView(definition: ProviderDefinition, env: Env): ProviderView {
  return {
    id: definition.id,
    label: definition.label,
    protocol: definition.protocol,
    configured: (env[definition.apiKeyEnv]?.trim() ?? "").length > 0,
    apiKeyEnv: definition.apiKeyEnv,
    defaultModel: definition.defaultModel,
    baseUrl: definition.baseUrl,
    baseHost: new URL(definition.baseUrl).host,
  };
}

function isApiKeyEnv(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ENV_PATTERN.test(value) &&
    !value.startsWith("CURSOR_")
  );
}

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

function validateRequest(request: CompletionRequest): string | undefined {
  if (request.messages.length === 0 || request.messages.length > MAX_MESSAGES) {
    return `messages must contain 1 to ${MAX_MESSAGES} items.`;
  }
  for (const message of request.messages) {
    if (
      message.role !== "system" &&
      message.role !== "user" &&
      message.role !== "assistant"
    ) {
      return "Each message role must be system, user, or assistant.";
    }
    if (message.content.length === 0 || message.content.length > MAX_MESSAGE_CHARS) {
      return `Each message must be 1 to ${MAX_MESSAGE_CHARS} characters.`;
    }
  }
  if (
    request.maxTokens !== undefined &&
    (!Number.isInteger(request.maxTokens) ||
      request.maxTokens < 1 ||
      request.maxTokens > MAX_OUTPUT_TOKENS)
  ) {
    return `maxTokens must be an integer from 1 to ${MAX_OUTPUT_TOKENS}.`;
  }
  if (
    request.temperature !== undefined &&
    (request.temperature < 0 || request.temperature > 2)
  ) {
    return "temperature must be between 0 and 2.";
  }
  if (request.model !== undefined && request.model.trim().length > 200) {
    return "model must be at most 200 characters.";
  }
  return undefined;
}

function readContent(value: unknown): string | undefined {
  const choice = firstChoice(value);
  if (choice === undefined) return undefined;
  const message = choice.message;
  if (message === null || typeof message !== "object") return undefined;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part);
    } else if (part !== null && typeof part === "object" && "text" in part) {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join("") : undefined;
}

function readModel(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const model = (value as { model?: unknown }).model;
  return typeof model === "string" && model.length > 0 ? model : undefined;
}

function readFinishReason(value: unknown): string | null {
  const choice = firstChoice(value);
  if (choice === undefined) return null;
  const reason = choice.finish_reason;
  return typeof reason === "string" ? reason : null;
}

function readUsage(value: unknown): {
  promptTokens: number | null;
  completionTokens: number | null;
} {
  if (value === null || typeof value !== "object") {
    return { promptTokens: null, completionTokens: null };
  }
  const usage = (value as { usage?: unknown }).usage;
  if (usage === null || typeof usage !== "object") {
    return { promptTokens: null, completionTokens: null };
  }
  const prompt = (usage as { prompt_tokens?: unknown }).prompt_tokens;
  const completion = (usage as { completion_tokens?: unknown }).completion_tokens;
  return {
    promptTokens: typeof prompt === "number" ? prompt : null,
    completionTokens: typeof completion === "number" ? completion : null,
  };
}

function firstChoice(value: unknown):
  | { message?: unknown; finish_reason?: unknown }
  | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const choice = choices[0];
  if (choice === null || typeof choice !== "object") return undefined;
  return choice as { message?: unknown; finish_reason?: unknown };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 400);
  return "Request failed.";
}

function redact(text: string, secret: string): string {
  if (secret.length === 0) return text;
  return text.split(secret).join("[redacted]");
}
