import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HostMcpCallResult, JsonValue } from "@cursor/bdk";
import { dataDir, deliverPages, type DeliveredPage } from "./deliver.js";

const PEER = "vat-books";

export type VatNotice = { notified: boolean; sessionId?: string; status?: string; reason?: string };

export type SendResult = {
  bin: string;
  inbox: "eval" | "vat";
  pageCount: number;
  pages: DeliveredPage[];
  vat: VatNotice;
  next: string;
};

type Mcp = {
  names: () => string[];
  callTool: (name: string, tool: string, args?: Record<string, unknown>) => Promise<HostMcpCallResult>;
};

type Memory = {
  get: (key: string) => Promise<JsonValue | undefined>;
  put: (key: string, value: JsonValue) => Promise<void>;
};

export async function sendToVat(input: {
  bin: string;
  paths: string[];
  workspaceDir: string;
  evalRun: boolean;
  mcp: Mcp;
  kv: Memory;
}): Promise<SendResult> {
  const dir = input.evalRun ? await fs.mkdtemp(path.join(os.tmpdir(), "vat-pages-")) : dataDir();
  const delivered = await deliverPages({
    workspaceDir: input.workspaceDir,
    dataDir: dir,
    bin: input.bin,
    paths: input.paths,
  });
  const vat = input.evalRun ? { notified: false, reason: "eval" } : await notifyVat(input.mcp, input.kv, delivered);
  return {
    bin: delivered.bin,
    inbox: input.evalRun ? "eval" : "vat",
    pageCount: delivered.pages.length,
    pages: delivered.pages,
    vat,
    next: "Pages are pending in the VAT inbox. The VAT books agent fills Mushak 6.1 only after the operator confirms each page. This agent does not fill 6.1.",
  };
}

async function notifyVat(
  mcp: Mcp,
  kv: Memory,
  delivered: { bin: string; pages: DeliveredPage[] },
): Promise<VatNotice> {
  if (!mcp.names().includes(PEER)) {
    return { notified: false, reason: "VAT agent peer is not connected. Pages are in the shared inbox." };
  }
  const key = `handoff:${delivered.bin}`;
  const previous = sessionIdOf(await kv.get(key));
  const message = handoffMessage(delivered);
  let result = await ask(mcp, message, previous);
  if (!result.ok && previous) result = await ask(mcp, message, undefined);
  if (!result.ok) return { notified: false, reason: result.reason };
  if (result.sessionId) {
    await kv.put(key, {
      sessionId: result.sessionId,
      uploadIds: delivered.pages.map((page) => page.uploadId),
      at: new Date().toISOString(),
    });
  }
  return { notified: true, sessionId: result.sessionId, status: result.status };
}

function handoffMessage(delivered: { bin: string; pages: DeliveredPage[] }): string {
  const lines = delivered.pages.map((page) => `- ${page.uploadId} ${page.fileName}`);
  return [
    "এক পাতা করে স্ক্যান ওয়েবসাইটের ইনবক্সে আছে। স্ট্যাটাস pending।",
    "নিজে থেকে confirm_upload কোরো না। অপারেটর কনফার্ম না করা পর্যন্ত save_bill_of_entry কোরো না।",
    "",
    `BIN: ${delivered.bin}`,
    "আপলোড:",
    ...lines,
    "",
    "অপারেটর কনফার্ম করলে প্রতিটি পাতা পড়ে মূসক ৬.১-এ save_bill_of_entry করো। পরিমাণ ঘর ৩৮। আগের নিয়ম বদলাবে না। অস্পষ্ট অঙ্ক অনুমান কোরো না।",
  ].join("\n");
}

async function ask(
  mcp: Mcp,
  message: string,
  sessionId: string | undefined,
): Promise<{ ok: boolean; sessionId?: string; status?: string; reason?: string }> {
  try {
    const result = await mcp.callTool(PEER, "ask", {
      message,
      waitSeconds: 0,
      ...(sessionId ? { sessionId } : {}),
    });
    const text = result.content.find((part) => part.type === "text" && "text" in part);
    const body = text && "text" in text && typeof text.text === "string" ? text.text : "";
    if (result.isError) return { ok: false, reason: body || "VAT agent did not accept the pages." };
    const parsed: unknown = body.startsWith("{") ? JSON.parse(body) : undefined;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: true, status: "sent" };
    const row = parsed as { status?: unknown; sessionId?: unknown; errorMessage?: unknown };
    if (row.status === "error") {
      return { ok: false, reason: typeof row.errorMessage === "string" ? row.errorMessage : "VAT agent did not accept the pages." };
    }
    return {
      ok: true,
      status: typeof row.status === "string" ? row.status : "sent",
      sessionId: typeof row.sessionId === "string" ? row.sessionId : sessionId,
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "VAT agent did not accept the pages." };
  }
}

function sessionIdOf(value: JsonValue | undefined): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const sessionId = value.sessionId;
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined;
}
