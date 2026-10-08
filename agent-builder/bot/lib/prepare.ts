import { createHash } from "node:crypto";
import { loadCatalog, type ProviderView } from "./providers.js";

const ID_PATTERN = /^[a-z][a-z0-9_-]{0,40}$/;
const TOOL_PATTERN = /^[a-z][a-z0-9_]{0,40}$/;
const SECRET_PATTERN =
  /(?:sk-[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|api[_-]?key\s*[:=]\s*\S+)/i;

export type AgentCondition = {
  id: string;
  text: string;
};

export type AgentToolSpec = {
  name: string;
  description: string;
};

export type Evidence = {
  conditionId: string;
  quote: string;
};

export type PrepareInput = {
  name: string;
  goal: string;
  conditions: AgentCondition[];
  instructions: string;
  tools: AgentToolSpec[];
  evidence: Evidence[];
  providerId?: string;
  model?: string;
};

export type Check = {
  id: string;
  pass: boolean;
  detail: string;
};

export type CredentialSlot = {
  providerId: string;
  n8nCredentialName: string;
  n8nType: "openAiApi";
  baseUrl: string;
  paste: "API key only";
};

export type PrepareResult = {
  ready: boolean;
  passed: number;
  total: number;
  checks: Check[];
  credentials: CredentialSlot[];
  importSteps: string[];
  agent?: {
    name: string;
    goal: string;
    providerId: string;
    model: string;
    instructions: string;
    tools: AgentToolSpec[];
  };
  workflow?: N8nWorkflow;
};

type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export type N8nWorkflow = {
  name: string;
  nodes: N8nNode[];
  connections: { [key: string]: { [key: string]: N8nLink[][] } };
  active: false;
  settings: { executionOrder: "v1" };
  pinData: { [key: string]: Json };
  meta: { templateCredsSetupCompleted: false };
};

type N8nNode = {
  parameters: { [key: string]: Json };
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  webhookId?: string;
  credentials?: {
    openAiApi: { id: string; name: string };
  };
};

type N8nLink = {
  node: string;
  type: string;
  index: 0;
};

type Env = Record<string, string | undefined>;

const PLACEHOLDER_CREDENTIAL_ID = "REPLACE_WITH_N8N_CREDENTIAL";

export function prepareAgent(input: PrepareInput, env: Env = process.env): PrepareResult {
  const checks: Check[] = [];
  const providerId = input.providerId ?? "miarouter";
  const catalog = loadCatalog(env);
  const provider = catalog.providers.find((item) => item.id === providerId);
  checks.push(providerCheck(providerId, provider, catalog.providers.map((item) => item.id)));

  const conditions = conditionChecks(input);
  checks.push(...conditions.checks);

  const secretText = [
    input.name,
    input.goal,
    input.instructions,
    ...input.tools.map((tool) => `${tool.name} ${tool.description}`),
    ...input.evidence.map((item) => item.quote),
  ].join("\n");
  const secret = SECRET_PATTERN.test(secretText);
  checks.push({
    id: "no_secret",
    pass: !secret,
    detail: secret
      ? "A secret-looking value is in the spec. Leave every key for the user to paste in n8n."
      : "No API key is embedded in the agent.",
  });

  const providerReady = provider !== undefined && !secret && conditions.ok;
  if (!providerReady || provider === undefined) {
    return finish(checks, []);
  }

  const model = input.model?.trim() || provider.defaultModel;
  const credentialName = `${provider.label} API key`;
  const workflow = buildWorkflow({
    name: input.name.trim(),
    instructions: input.instructions.trim(),
    tools: input.tools,
    model,
    baseUrl: provider.baseUrl,
    credentialName,
  });
  checks.push(...workflowChecks(workflow, provider, model, input.instructions.trim()));

  const credentials: CredentialSlot[] = [
    {
      providerId: provider.id,
      n8nCredentialName: credentialName,
      n8nType: "openAiApi",
      baseUrl: provider.baseUrl,
      paste: "API key only",
    },
  ];
  const ready = checks.every((check) => check.pass);
  const result = finish(checks, credentials);
  if (!ready) return result;
  return {
    ...result,
    agent: {
      name: input.name.trim(),
      goal: input.goal.trim(),
      providerId: provider.id,
      model,
      instructions: input.instructions.trim(),
      tools: input.tools,
    },
    workflow,
  };
}

function providerCheck(
  providerId: string,
  provider: ProviderView | undefined,
  known: string[],
): Check {
  if (provider === undefined) {
    return {
      id: "provider",
      pass: false,
      detail: `Unknown provider ${providerId}. Known ids: ${known.join(", ")}.`,
    };
  }
  return {
    id: "provider",
    pass: true,
    detail: provider.configured
      ? `${provider.label} is configured on the builder. The n8n credential is still entered by the user.`
      : `${provider.label} is selected. The user pastes ${provider.apiKeyEnv} into n8n.`,
  };
}

function conditionChecks(input: PrepareInput): { ok: boolean; checks: Check[] } {
  const checks: Check[] = [];
  const ids = input.conditions.map((condition) => condition.id);
  const unique = new Set(ids);
  checks.push({
    id: "conditions",
    pass: input.conditions.length > 0 && unique.size === ids.length && ids.every((id) => ID_PATTERN.test(id)),
    detail:
      input.conditions.length === 0
        ? "At least one requirement is required."
        : unique.size === ids.length
          ? `${input.conditions.length} requirement(s) to verify.`
          : "Requirement ids must be unique.",
  });

  for (const condition of input.conditions) {
    const quotes = input.evidence.filter((item) => item.conditionId === condition.id);
    if (quotes.length !== 1) {
      checks.push({
        id: `condition:${condition.id}`,
        pass: false,
        detail: `Requirement "${condition.text}" needs exactly one evidence quote.`,
      });
      continue;
    }
    const quote = squash(quotes[0].quote);
    const found = squash(input.instructions).includes(quote);
    checks.push({
      id: `condition:${condition.id}`,
      pass: found,
      detail: found
        ? `Passed. The instructions contain the requirement "${condition.text}".`
        : `Failed. The quote for "${condition.text}" is not in the instructions, so this requirement is not enforced.`,
    });
  }
  for (const item of input.evidence) {
    if (!ids.includes(item.conditionId)) {
      checks.push({
        id: `condition:${item.conditionId}`,
        pass: false,
        detail: `Evidence quotes unknown requirement ${item.conditionId}.`,
      });
    }
  }
  const toolsOk = input.tools.every(
    (tool) => TOOL_PATTERN.test(tool.name) && tool.description.trim().length > 0,
  );
  checks.push({
    id: "tools",
    pass: toolsOk,
    detail: toolsOk ? "Tool names are usable." : "Each tool needs a lowercase name and a description.",
  });
  return { ok: checks.every((check) => check.pass), checks };
}

function workflowChecks(
  workflow: N8nWorkflow,
  provider: ProviderView,
  model: string,
  instructions: string,
): Check[] {
  const byName = new Map(workflow.nodes.map((node) => [node.name, node]));
  const trigger = byName.get("When chat message received");
  const agent = byName.get("AI Agent");
  const chatModel = byName.get(`${provider.label} Chat Model`);
  const memory = byName.get("Memory");
  const systemMessage = readSystemMessage(agent);
  const baseUrl = readBaseUrl(chatModel);
  const encoded = JSON.stringify(workflow);
  return [
    {
      id: "n8n_trigger",
      pass: trigger?.type === "@n8n/n8n-nodes-langchain.chatTrigger",
      detail: "Chat trigger opens the n8n conversation.",
    },
    {
      id: "n8n_agent",
      pass: agent?.type === "@n8n/n8n-nodes-langchain.agent" && systemMessage.includes(instructions),
      detail: "AI Agent carries the checked instructions.",
    },
    {
      id: "n8n_model",
      pass: chatModel?.type === "@n8n/n8n-nodes-langchain.lmChatOpenAi" && readModel(chatModel) === model,
      detail: `Model node uses ${model}.`,
    },
    {
      id: "n8n_base_url",
      pass: baseUrl === provider.baseUrl,
      detail: `Base URL is ${provider.baseUrl}.`,
    },
    {
      id: "n8n_memory",
      pass: memory?.type === "@n8n/n8n-nodes-langchain.memoryBufferWindow",
      detail: "Window memory keeps the chat session.",
    },
    {
      id: "n8n_connections",
      pass: connectionsWired(workflow, `${provider.label} Chat Model`),
      detail: "Trigger, model, and memory are connected to the agent.",
    },
    {
      id: "n8n_credential",
      pass: chatModel?.credentials?.openAiApi.id === PLACEHOLDER_CREDENTIAL_ID,
      detail: "The workflow has a credential slot and no key.",
    },
    {
      id: "n8n_no_secret",
      pass: !SECRET_PATTERN.test(encoded),
      detail: "The workflow JSON contains no API key.",
    },
  ];
}

function buildWorkflow(input: {
  name: string;
  instructions: string;
  tools: AgentToolSpec[];
  model: string;
  baseUrl: string;
  credentialName: string;
}): N8nWorkflow {
  const slug = slugify(input.name);
  const modelName = `${input.credentialName.replace(/ API key$/, "")} Chat Model`;
  const systemMessage = systemPrompt(input.instructions, input.tools);
  const trigger: N8nNode = {
    parameters: { public: false, options: {} },
    id: nodeId(slug, "trigger"),
    name: "When chat message received",
    type: "@n8n/n8n-nodes-langchain.chatTrigger",
    typeVersion: 1.4,
    position: [240, 300],
    webhookId: slug,
  };
  const agent: N8nNode = {
    parameters: {
      promptType: "auto",
      options: { systemMessage },
    },
    id: nodeId(slug, "agent"),
    name: "AI Agent",
    type: "@n8n/n8n-nodes-langchain.agent",
    typeVersion: 3.1,
    position: [560, 300],
  };
  const chatModel: N8nNode = {
    parameters: {
      model: { __rl: true, mode: "id", value: input.model },
      responsesApiEnabled: false,
      options: { baseURL: input.baseUrl },
    },
    id: nodeId(slug, "model"),
    name: modelName,
    type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
    typeVersion: 1.2,
    position: [560, 540],
    credentials: {
      openAiApi: { id: PLACEHOLDER_CREDENTIAL_ID, name: input.credentialName },
    },
  };
  const memory: N8nNode = {
    parameters: { sessionIdType: "fromInput", contextWindowLength: 10 },
    id: nodeId(slug, "memory"),
    name: "Memory",
    type: "@n8n/n8n-nodes-langchain.memoryBufferWindow",
    typeVersion: 1.3,
    position: [760, 540],
  };
  return {
    name: input.name,
    nodes: [trigger, agent, chatModel, memory],
    connections: {
      "When chat message received": {
        main: [[{ node: "AI Agent", type: "main", index: 0 }]],
      },
      [modelName]: {
        ai_languageModel: [[{ node: "AI Agent", type: "ai_languageModel", index: 0 }]],
      },
      Memory: {
        ai_memory: [[{ node: "AI Agent", type: "ai_memory", index: 0 }]],
      },
    },
    active: false,
    settings: { executionOrder: "v1" },
    pinData: {},
    meta: { templateCredsSetupCompleted: false },
  };
}

function systemPrompt(instructions: string, tools: AgentToolSpec[]): string {
  if (tools.length === 0) return instructions;
  const lines = tools.map((tool) => `- ${tool.name}: ${tool.description}`);
  return `${instructions}\n\n## Tools\n${lines.join("\n")}`;
}

function finish(checks: Check[], credentials: CredentialSlot[]): PrepareResult {
  const passed = checks.filter((check) => check.pass).length;
  const ready = checks.length > 0 && passed === checks.length;
  return {
    ready,
    passed,
    total: checks.length,
    checks,
    credentials: ready ? credentials : [],
    importSteps: ready ? importSteps(credentials[0]) : [],
  };
}

function importSteps(slot: CredentialSlot | undefined): string[] {
  if (slot === undefined) return [];
  return [
    "In n8n open the workflow menu and choose Import from File, or paste this JSON into the canvas.",
    `Create an OpenAI credential named "${slot.n8nCredentialName}". Paste only the API key.`,
    `If that credential has a Base URL field, set it to ${slot.baseUrl}. The model node already uses this URL.`,
    `On the chat model node, select "${slot.n8nCredentialName}".`,
    "Open the chat trigger and send a test message. Do not put the key in the workflow.",
  ];
}

function connectionsWired(workflow: N8nWorkflow, modelName: string): boolean {
  const trigger = workflow.connections["When chat message received"]?.main?.[0]?.[0];
  const model = workflow.connections[modelName]?.ai_languageModel?.[0]?.[0];
  const memory = workflow.connections.Memory?.ai_memory?.[0]?.[0];
  return (
    trigger?.node === "AI Agent" &&
    trigger.type === "main" &&
    model?.node === "AI Agent" &&
    model.type === "ai_languageModel" &&
    memory?.node === "AI Agent" &&
    memory.type === "ai_memory"
  );
}

function readSystemMessage(node: N8nNode | undefined): string {
  const options = node?.parameters.options;
  if (options === null || typeof options !== "object") return "";
  const message = (options as { systemMessage?: unknown }).systemMessage;
  return typeof message === "string" ? message : "";
}

function readModel(node: N8nNode | undefined): string {
  const model = node?.parameters.model;
  if (model === null || typeof model !== "object") return "";
  const value = (model as { value?: unknown }).value;
  return typeof value === "string" ? value : "";
}

function readBaseUrl(node: N8nNode | undefined): string {
  const options = node?.parameters.options;
  if (options === null || typeof options !== "object") return "";
  const baseURL = (options as { baseURL?: unknown }).baseURL;
  return typeof baseURL === "string" ? baseURL : "";
}

function squash(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug.length > 0 ? slug : "agent";
}

function nodeId(slug: string, part: string): string {
  return createHash("sha256").update(`${slug}:${part}`).digest("hex").slice(0, 32);
}
