import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addApi, listApis, removeApi } from "../bot/lib/apis.js";
import { diskDir, openDisk } from "../bot/lib/disk.js";
import { type FormId, buildBook, toHtml } from "../bot/lib/forms.js";
import { recordDeletion } from "../bot/lib/mirror.js";
import { assertMonth, monthRange, partyActivity, previewReset, applyReset } from "../bot/lib/month.js";
import { htmlToPdf } from "../bot/lib/pdf.js";
import { importerPinMatches, setImporterPin } from "../bot/lib/pins.js";
import { monthlyReport, reportHtml } from "../bot/lib/report.js";
import { listBins, loadImporter, saveImporter, type Kv } from "../bot/lib/store.js";
import { confirmUpload, listUploads, saveUpload, uploadFile } from "../bot/lib/uploads.js";
import { normalizeBin } from "../bot/lib/vat.js";

type Session =
  | { kind: "user"; bin: string; exp: number }
  | { kind: "operator"; exp: number };

const sessions = new Map<string, Session>();
const fails = new Map<string, { n: number; until: number }>();
const MAX_BODY = 8 * 1024 * 1024;
const DAY_MS = 12 * 60 * 60 * 1000;

class HttpError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type ServerOptions = {
  port?: number;
  host?: string;
  dataDir?: string;
  operatorPin?: string;
};

export function startServer(opts: ServerOptions = {}): Promise<{ port: number; close: () => Promise<void> }> {
  const dataDir = opts.dataDir ?? diskDir();
  const operatorPin = opts.operatorPin ?? process.env.OPERATOR_PIN ?? "";
  const kv = () => openDisk(dataDir);
  const server = http.createServer((req, res) => {
    handle(req, res, { dataDir, operatorPin, kv: kv() }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "ত্রুটি হয়েছে।";
      const status = error instanceof HttpError ? error.status : 400;
      if (res.headersSent) return;
      sendHtml(res, status, page("ত্রুটি", `<p>${esc(message)}</p>`));
    });
  });
  const host = opts.host ?? "0.0.0.0";
  const port = opts.port ?? Number(process.env.PORT ?? 8080);
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      resolve({
        port: actual,
        close: () => new Promise((done, reject) => server.close((error) => (error ? reject(error) : done()))),
      });
    });
  });
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { dataDir: string; operatorPin: string; kv: Kv },
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  if (method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }
  if (method === "GET" && url.pathname === "/") return sendHtml(res, 200, loginPage(url.searchParams.get("msg")));
  if (method === "POST" && url.pathname === "/login") return userLogin(req, res, ctx);
  if (method === "POST" && url.pathname === "/logout") return logout(res, "sid", "/");
  if (method === "GET" && url.pathname === "/app") return userHome(req, res, ctx, url);
  if (method === "POST" && url.pathname === "/upload") return userUpload(req, res, ctx);
  if (method === "GET" && url.pathname === "/download") return userDownload(req, res, ctx, url);
  if (method === "GET" && url.pathname.startsWith("/file/")) return sendFile(req, res, ctx, url.pathname.slice("/file/".length), false);
  if (method === "GET" && url.pathname === "/op") return operatorHome(req, res, ctx, url);
  if (method === "POST" && url.pathname === "/op/login") return operatorLogin(req, res, ctx);
  if (method === "POST" && url.pathname === "/op/logout") return logout(res, "opid", "/op");
  if (method === "POST" && url.pathname === "/op/pin") return operatorPin(req, res, ctx);
  if (method === "POST" && url.pathname === "/op/reset") return operatorReset(req, res, ctx);
  if (method === "GET" && url.pathname === "/op/parties") return operatorParties(req, res, ctx, url);
  if (method === "GET" && url.pathname === "/op/report") return operatorReport(req, res, ctx, url, false);
  if (method === "GET" && url.pathname === "/op/report.pdf") return operatorReport(req, res, ctx, url, true);
  if (method === "POST" && url.pathname === "/op/upload/confirm") return operatorConfirm(req, res, ctx);
  if (method === "POST" && url.pathname === "/op/api") return operatorAddApi(req, res, ctx);
  if (method === "POST" && url.pathname === "/op/api/remove") return operatorRemoveApi(req, res, ctx);
  if (method === "GET" && url.pathname.startsWith("/op/file/")) {
    return sendFile(req, res, ctx, url.pathname.slice("/op/file/".length), true);
  }
  sendHtml(res, 404, page("নেই", "<p>এই পাতা নেই।</p>"));
}

async function userLogin(req: http.IncomingMessage, res: http.ServerResponse, ctx: { kv: Kv }): Promise<void> {
  const form = await readForm(req);
  const ip = clientIp(req);
  const key = `${ip}|${form.get("bin") ?? ""}`;
  if (locked(key)) throw new HttpError("অনেকবার ভুল হয়েছে। কিছুক্ষণ পর চেষ্টা করুন।", 429);
  const bin = await importerPinMatches(ctx.kv, form.get("bin") ?? "", form.get("pin") ?? "");
  if (!bin) {
    markFail(key);
    redirect(res, "/?msg=" + encodeURIComponent("BIN বা পিন মিলছে না।"));
    return;
  }
  clearFail(key);
  redirect(res, "/app", { sid: startSession({ kind: "user", bin, exp: Date.now() + DAY_MS }) });
}

async function operatorLogin(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { operatorPin: string },
): Promise<void> {
  if (!ctx.operatorPin) throw new HttpError("OPERATOR_PIN সেট করা নেই।");
  const form = await readForm(req);
  const key = `op|${clientIp(req)}`;
  if (locked(key)) throw new HttpError("অনেকবার ভুল হয়েছে। কিছুক্ষণ পর চেষ্টা করুন।", 429);
  if (!sameText(form.get("pin") ?? "", ctx.operatorPin)) {
    markFail(key);
    redirect(res, "/op?msg=" + encodeURIComponent("পিন মিলছে না।"));
    return;
  }
  clearFail(key);
  redirect(res, "/op", { opid: startSession({ kind: "operator", exp: Date.now() + DAY_MS }) });
}

function logout(res: http.ServerResponse, cookie: string, to: string): void {
  const id = "";
  redirect(res, to, { [cookie]: id }, 0);
}

async function userHome(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { kv: Kv },
  url: URL,
): Promise<void> {
  const bin = requireUser(req);
  const uploads = await listUploads(ctx.kv, bin);
  const rows = uploads
    .map(
      (row) =>
        `<tr><td>${esc(row.createdAt.slice(0, 16).replace("T", " "))}</td><td>${esc(row.fileName)}</td><td>${esc(statusText(row.status))}</td></tr>`,
    )
    .join("");
  const body = `
    ${note(url)}
    <section class="card">
      <h2>আপলোড</h2>
      <p class="note">এক পাতা করে দিন। কনফার্মের পর খাতায় যাবে।</p>
      <form method="post" action="/upload" enctype="multipart/form-data">
        <input type="file" name="page" accept="image/jpeg,image/png,image/webp,application/pdf" required>
        <button>আপলোড</button>
      </form>
    </section>
    <section class="card">
      <h2>আপনার পাতা</h2>
      <table><thead><tr><th>সময়</th><th>ফাইল</th><th>অবস্থা</th></tr></thead><tbody>${rows || `<tr><td colspan="3">এখনো কোনো আপলোড নেই।</td></tr>`}</tbody></table>
    </section>
    <section class="card">
      <h2>৬.১ / ৬.২ / ৬.৩ / রিপোর্ট</h2>
      <form method="get" action="/download" class="row">
        <label>মাস <input type="month" name="month" required></label>
        <button name="form" value="6.1">৬.১</button>
        <button name="form" value="6.2">৬.২</button>
        <button name="form" value="6.3">৬.৩</button>
        <button name="form" value="report">রিপোর্ট</button>
      </form>
      <p class="note">মাস বেছে পিডিএফ ডাউনলোড হবে।</p>
    </section>`;
  sendHtml(res, 200, page("মূসক বই", body, { nav: userNav() }));
}

async function userUpload(req: http.IncomingMessage, res: http.ServerResponse, ctx: { dataDir: string; kv: Kv }): Promise<void> {
  const bin = requireUser(req);
  const file = await readSingleFile(req);
  const type = sniff(file.data);
  if (!type) throw new HttpError("শুধু JPG, PNG, WEBP বা এক পাতার PDF দেওয়া যাবে।");
  await saveUpload(ctx.kv, ctx.dataDir, { bin, fileName: safeName(file.filename), contentType: type, data: file.data });
  redirect(res, "/app?msg=" + encodeURIComponent("আপলোড হয়েছে। কনফার্মের পর খাতায় যাবে।"));
}

async function userDownload(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { kv: Kv },
  url: URL,
): Promise<void> {
  const bin = requireUser(req);
  const month = url.searchParams.get("month") ?? "";
  const form = url.searchParams.get("form") ?? "";
  const doc = await loadImporter(ctx.kv, bin);
  const html = await bookHtml(doc, bin, month, form);
  const pdf = await htmlToPdf(html);
  const name = form === "report" ? `report-${month}.pdf` : `mushak-${form}-${month}.pdf`;
  sendPdf(res, pdf, name);
}

async function operatorHome(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { operatorPin: string; kv: Kv },
  url: URL,
): Promise<void> {
  if (!operatorSession(req)) return sendHtml(res, 200, operatorLoginPage(url.searchParams.get("msg"), ctx.operatorPin.length > 0));
  const bins = await listBins(ctx.kv);
  const uploads = (await listUploads(ctx.kv)).filter((row) => row.status === "pending");
  const apis = await listApis(ctx.kv);
  const uploadRows = uploads
    .map((row) => {
      const preview =
        row.contentType.startsWith("image/")
          ? `<img alt="" src="/op/file/${esc(row.id)}" style="max-width:180px;max-height:120px">`
          : `<a href="/op/file/${esc(row.id)}">PDF</a>`;
      return `<tr><td>${esc(row.bin)}</td><td>${esc(row.fileName)}<br>${preview}</td><td>
        <form method="post" action="/op/upload/confirm"><input type="hidden" name="id" value="${esc(row.id)}"><button>কনফার্ম</button></form>
      </td></tr>`;
    })
    .join("");
  const apiRows = apis
    .map(
      (row) =>
        `<tr><td>${esc(row.label)}</td><td>${esc(row.id)}</td><td>${esc(row.baseUrl)}</td><td>${esc(row.apiKeyEnv)}</td><td>${esc(row.note)}</td><td>
          <form method="post" action="/op/api/remove"><input type="hidden" name="id" value="${esc(row.id)}"><button>সরান</button></form>
        </td></tr>`,
    )
    .join("");
  const options = bins.map((bin) => `<option value="${esc(bin)}">`).join("");
  const body = `
    ${note(url)}
    <section class="card">
      <h2>মাস্টার রিসেট</h2>
      <p class="note">এক BIN-এর এক মাসের সব বিল ও চালান। আগে ডিলিট, তারপর কনফার্মেশন মেসেজ কনফার্ম।</p>
      <form method="post" action="/op/reset" class="row">
        <label>BIN <input name="bin" list="bins" required pattern="[0-9০-৯\\-\\s]{13,20}"></label>
        <label>মাস <input type="month" name="month" required></label>
        <button class="danger">ডিলিট</button>
      </form>
      <datalist id="bins">${options}</datalist>
    </section>
    <section class="card">
      <h2>মাসিক রিপোর্ট</h2>
      <form method="get" action="/op/parties" class="row">
        <label>মাস <input type="month" name="month" required></label>
        <button>পার্টি দেখুন</button>
      </form>
    </section>
    <section class="card">
      <h2>আপলোড কনফার্ম</h2>
      <p class="note">কনফার্মের আগে খাতায় যায় না। কনফার্মের পর এজেন্ট পড়ে সেভ করলে সংখ্যা বসবে।</p>
      <table><thead><tr><th>BIN</th><th>পাতা</th><th></th></tr></thead><tbody>${uploadRows || `<tr><td colspan="3">অপেক্ষমাণ আপলোড নেই।</td></tr>`}</tbody></table>
    </section>
    <section class="card">
      <h2>ইউজার পিন</h2>
      <form method="post" action="/op/pin" class="row">
        <label>BIN <input name="bin" required></label>
        <label>পিন <input name="pin" required inputmode="numeric" pattern="[0-9]{4,8}"></label>
        <label>আবার <input name="pin2" required inputmode="numeric" pattern="[0-9]{4,8}"></label>
        <button>পিন সেট</button>
      </form>
    </section>
    <section class="card">
      <h2>API যোগ</h2>
      <p class="note">কী এখানে লিখবেন না। শুধু এনভির নাম, যেমন NBR_API_KEY। নতুন API পরে এই ফর্ম থেকেই যোগ হবে।</p>
      <form method="post" action="/op/api" class="row">
        <label>নাম <input name="label" required></label>
        <label>Base URL <input name="baseUrl" required placeholder="https://example.com/v1"></label>
        <label>কী-এর এনভ <input name="apiKeyEnv" required placeholder="NBR_API_KEY"></label>
        <label>নোট <input name="note"></label>
        <button>যোগ করুন</button>
      </form>
      <table><thead><tr><th>নাম</th><th>id</th><th>URL</th><th>এনভ</th><th>নোট</th><th></th></tr></thead><tbody>${apiRows || `<tr><td colspan="6">এখনো কোনো API নেই।</td></tr>`}</tbody></table>
    </section>`;
  sendHtml(res, 200, page("অপারেটর", body, { nav: opNav() }));
}

async function operatorPin(req: http.IncomingMessage, res: http.ServerResponse, ctx: { kv: Kv }): Promise<void> {
  requireOperator(req);
  const form = await readForm(req);
  if ((form.get("pin") ?? "") !== (form.get("pin2") ?? "")) throw new HttpError("দুইবারের পিন এক নয়।");
  const bin = await setImporterPin(ctx.kv, form.get("bin") ?? "", form.get("pin") ?? "");
  redirect(res, "/op?msg=" + encodeURIComponent(`BIN ${bin}-এর পিন সেট হয়েছে।`));
}

async function operatorReset(req: http.IncomingMessage, res: http.ServerResponse, ctx: { kv: Kv }): Promise<void> {
  requireOperator(req);
  const form = await readForm(req);
  const bin = normalizeBin(form.get("bin") ?? "");
  const month = form.get("month") ?? "";
  const doc = await loadImporter(ctx.kv, bin);
  if (!doc) throw new HttpError("এই BIN-এর কোনো বই নেই।");
  const preview = previewReset(doc, month);
  const confirm = form.get("confirm") ?? "";
  if (!confirm) {
    sendHtml(res, 200, page("কনফার্মেশন", resetConfirmHtml(preview), { nav: opNav() }));
    return;
  }
  if (confirm !== preview.phrase) throw new HttpError("কনফার্মেশন মেলেনি। কিছু মুছে ফেলা হয়নি।");
  applyReset(doc, month);
  await saveImporter(ctx.kv, doc);
  await recordDeletion(ctx.kv, bin, month);
  redirect(res, "/op?msg=" + encodeURIComponent(`${bin} এর ${month} মাস মুছে ফেলা হয়েছে।`));
}

async function operatorParties(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { kv: Kv },
  url: URL,
): Promise<void> {
  requireOperator(req);
  const month = url.searchParams.get("month") ?? "";
  const parties = [];
  for (const bin of await listBins(ctx.kv)) {
    const doc = await loadImporter(ctx.kv, bin);
    if (!doc) continue;
    const row = partyActivity(doc, month);
    if (row) parties.push(row);
  }
  const rows = parties
    .map(
      (row) => `<tr><td>${esc(row.name)}</td><td>${esc(row.bin)}</td><td>${row.boeCount}</td><td>${row.challanCount}</td><td>
        <form method="get" action="/op/report">
          <input type="hidden" name="bin" value="${esc(row.bin)}">
          <input type="hidden" name="month" value="${esc(month)}">
          <button>রিপোর্ট জেনারেট</button>
        </form>
      </td></tr>`,
    )
    .join("");
  const body = `
    <section class="card">
      <h2>${esc(month)} — যাদের লেনদেন আছে</h2>
      <p class="note">রিপোর্ট জেনারেট চাপলে তবেই সেই পার্টির রিপোর্ট ও সার্ভিস বিল তৈরি হবে।</p>
      <table><thead><tr><th>পার্টি</th><th>BIN</th><th>বিল অব এন্ট্রি</th><th>চালান</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5">এই মাসে কোনো পার্টির লেনদেন নেই।</td></tr>`}</tbody></table>
    </section>`;
  sendHtml(res, 200, page("মাসিক রিপোর্ট", body, { nav: opNav() }));
}

async function operatorReport(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { kv: Kv },
  url: URL,
  asPdf: boolean,
): Promise<void> {
  requireOperator(req);
  const bin = normalizeBin(url.searchParams.get("bin") ?? "");
  const month = url.searchParams.get("month") ?? "";
  const doc = await loadImporter(ctx.kv, bin);
  if (!doc) throw new HttpError("এই BIN-এর কোনো বই নেই।");
  const report = monthlyReport(doc, month);
  const html = withBar(reportHtml(report), `/op/report.pdf?bin=${encodeURIComponent(bin)}&month=${encodeURIComponent(month)}`);
  if (!asPdf) {
    sendHtml(res, 200, html);
    return;
  }
  sendPdf(res, await htmlToPdf(reportHtml(report)), `report-${bin}-${month}.pdf`);
}

async function operatorConfirm(req: http.IncomingMessage, res: http.ServerResponse, ctx: { kv: Kv }): Promise<void> {
  requireOperator(req);
  const form = await readForm(req);
  const upload = await confirmUpload(ctx.kv, form.get("id") ?? "");
  redirect(res, "/op?msg=" + encodeURIComponent(`BIN ${upload.bin}-এর পাতা কনফার্ম হয়েছে। এজেন্ট সেভ করলে খাতায় বসবে।`));
}

async function operatorAddApi(req: http.IncomingMessage, res: http.ServerResponse, ctx: { kv: Kv }): Promise<void> {
  requireOperator(req);
  const form = await readForm(req);
  const entry = await addApi(ctx.kv, {
    label: form.get("label") ?? "",
    baseUrl: form.get("baseUrl") ?? "",
    apiKeyEnv: form.get("apiKeyEnv") ?? "",
    note: form.get("note") ?? "",
  });
  redirect(res, "/op?msg=" + encodeURIComponent(`API ${entry.label} যোগ হয়েছে। কল করা হয়নি।`));
}

async function operatorRemoveApi(req: http.IncomingMessage, res: http.ServerResponse, ctx: { kv: Kv }): Promise<void> {
  requireOperator(req);
  const form = await readForm(req);
  await removeApi(ctx.kv, form.get("id") ?? "");
  redirect(res, "/op?msg=" + encodeURIComponent("API সরানো হয়েছে।"));
}

async function sendFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { dataDir: string; kv: Kv },
  id: string,
  operator: boolean,
): Promise<void> {
  const rows = await listUploads(ctx.kv);
  const upload = rows.find((row) => row.id === id);
  if (!upload) throw new HttpError("ফাইল নেই।", 404);
  if (operator) requireOperator(req);
  else if (requireUser(req) !== upload.bin) throw new HttpError("এই ফাইল আপনার নয়।", 403);
  const data = await fs.readFile(uploadFile(ctx.dataDir, id));
  res.writeHead(200, {
    "content-type": upload.contentType,
    "content-disposition": "inline",
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store",
  });
  res.end(data);
}

async function bookHtml(
  doc: Awaited<ReturnType<typeof loadImporter>>,
  bin: string,
  month: string,
  form: string,
): Promise<string> {
  assertMonth(month);
  if (form !== "report" && form !== "6.1" && form !== "6.2" && form !== "6.3") {
    throw new HttpError("বই ৬.১, ৬.২, ৬.৩ বা রিপোর্ট।");
  }
  if (!doc) return emptyBook(bin, month);
  if (form === "report") return reportHtml(monthlyReport(doc, month));
  return toHtml(buildBook(doc, form as FormId, monthRange(month)));
}

function resetConfirmHtml(preview: ReturnType<typeof previewReset>): string {
  if (preview.empty) {
    return `<section class="card"><p>${esc(preview.bin)} এর ${esc(preview.month)} মাসে মুছার মতো কিছু নেই।</p><p><a href="/op">ফিরে যান</a></p></section>`;
  }
  if (preview.blocked.length > 0) {
    const items = preview.blocked.map((row) => `<li>${esc(row.challanNo)} — ${esc(row.issueDate)}</li>`).join("");
    return `<section class="card"><p>এই মাসের বিলের চালান অন্য মাসে আছে, তাই মুছা হয়নি।</p><ul>${items}</ul><p><a href="/op">ফিরে যান</a></p></section>`;
  }
  return `<section class="card">
    <h2>কনফার্মেশন</h2>
    <p>BIN <strong>${esc(preview.bin)}</strong> এর <strong>${esc(preview.month)}</strong> মাসের সব ডাটা মুছে যাবে।</p>
    <p>বিল অব এন্ট্রি ${preview.boeCount}টি (${esc(preview.boeNumbers.join(", ") || "—")}), চালান ${preview.challanCount}টি (${esc(preview.challanNumbers.join(", ") || "—")})। অন্য মাস থাকবে।</p>
    <form method="post" action="/op/reset" class="row">
      <input type="hidden" name="bin" value="${esc(preview.bin)}">
      <input type="hidden" name="month" value="${esc(preview.month)}">
      <input type="hidden" name="confirm" value="${esc(preview.phrase)}">
      <button class="danger">কনফার্ম</button>
      <a class="btn" href="/op">বাতিল</a>
    </form>
  </section>`;
}

function statusText(status: string): string {
  if (status === "pending") return "অপেক্ষমাণ — কনফার্মের পর খাতায় যাবে";
  if (status === "confirmed") return "কনফার্ম হয়েছে — খাতায় তোলা হচ্ছে";
  return "খাতায় আছে";
}

function emptyBook(bin: string, month: string): string {
  return `<!doctype html><html lang="bn"><head><meta charset="utf-8"><title>খালি</title></head><body><p>BIN ${esc(bin)} — ${esc(month)} মাসে এখনো কোনো হিসাব নেই।</p></body></html>`;
}

function withBar(html: string, href: string): string {
  const bar = `<p style="font-family:sans-serif"><a href="${esc(href)}">পিডিএফ ডাউনলোড</a></p>`;
  return html.includes("<body>") ? html.replace("<body>", `<body>${bar}`) : bar + html;
}

function loginPage(msg: string | null): string {
  return page(
    "প্রবেশ",
    `${msg ? `<p class="note">${esc(msg)}</p>` : ""}
    <section class="card"><form method="post" action="/login" class="row">
      <label>BIN <input name="bin" required autocomplete="username"></label>
      <label>পিন <input name="pin" type="password" required inputmode="numeric" autocomplete="current-password"></label>
      <button>প্রবেশ</button>
    </form></section>`,
  );
}

function operatorLoginPage(msg: string | null, configured: boolean): string {
  if (!configured) return page("অপারেটর", "<p>OPERATOR_PIN সেট করা নেই।</p>");
  return page(
    "অপারেটর",
    `${msg ? `<p class="note">${esc(msg)}</p>` : ""}
    <section class="card"><form method="post" action="/op/login" class="row">
      <label>পিন <input name="pin" type="password" required></label>
      <button>প্রবেশ</button>
    </form></section>`,
  );
}

function userNav(): string {
  return `<a href="/app">হোম</a> <form method="post" action="/logout"><button>বের হন</button></form>`;
}

function opNav(): string {
  return `<a href="/op">অপারেটর</a> <form method="post" action="/op/logout"><button>বের হন</button></form>`;
}

function note(url: URL): string {
  const msg = url.searchParams.get("msg");
  return msg ? `<p class="note">${esc(msg)}</p>` : "";
}

function page(title: string, body: string, opts: { nav?: string } = {}): string {
  return `<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
    <style>
      body{font-family:"Noto Sans Bengali",sans-serif;margin:0;background:#f4f1ea;color:#1c1915}
      header,main{max-width:920px;margin:0 auto;padding:16px}
      header{display:flex;justify-content:space-between;align-items:center}
      h1{font-size:1.35rem;margin:0}
      a{color:#1f4b3a}
      button,.btn{background:#1f4b3a;color:#fff;border:0;border-radius:6px;padding:8px 14px;font:inherit;cursor:pointer;text-decoration:none;display:inline-block}
      button.danger{background:#8c2f2f}
      table{border-collapse:collapse;width:100%;background:#fff}
      th,td{border:1px solid #e4dfd6;padding:8px;text-align:left;vertical-align:top}
      th{background:#efeae2}
      form.row,header form{display:flex;gap:8px;flex-wrap:wrap;align-items:end}
      header form{display:inline}
      label{display:flex;flex-direction:column;gap:4px;font-size:.92rem}
      input{font:inherit;padding:8px;border:1px solid #ccc;border-radius:6px}
      .card{background:#fff;border-radius:10px;padding:16px;margin:16px 0}
      .note{color:#5c564c}
    </style></head><body>
    <header><h1>${esc(title)}</h1><nav>${opts.nav ?? `<a href="/op">অপারেটর</a>`}</nav></header>
    <main>${body}</main></body></html>`;
}

function requireUser(req: http.IncomingMessage): string {
  const session = sessionFrom(req, "sid");
  if (!session || session.kind !== "user") throw new HttpError("আগে BIN ও পিন দিয়ে ঢুকুন।", 401);
  return session.bin;
}

function requireOperator(req: http.IncomingMessage): void {
  if (!operatorSession(req)) throw new HttpError("অপারেটর হিসেবে ঢুকুন।", 401);
}

function operatorSession(req: http.IncomingMessage): boolean {
  return sessionFrom(req, "opid")?.kind === "operator";
}

function sessionFrom(req: http.IncomingMessage, cookie: string): Session | undefined {
  const id = readCookie(req, cookie);
  if (!id || !/^[a-f0-9]{48}$/.test(id)) return undefined;
  const session = sessions.get(id);
  if (!session) return undefined;
  if (session.exp < Date.now()) {
    sessions.delete(id);
    return undefined;
  }
  return session;
}

function startSession(session: Session): string {
  const id = crypto.randomBytes(24).toString("hex");
  sessions.set(id, session);
  return id;
}

function redirect(res: http.ServerResponse, location: string, cookies: Record<string, string> = {}, maxAge = DAY_MS / 1000): void {
  const headers = Object.entries(cookies).map(([name, value]) => setCookie(name, value, value ? maxAge : 0));
  const head: http.OutgoingHttpHeaders = { location };
  if (headers.length > 0) head["set-cookie"] = headers;
  res.writeHead(303, head);
  res.end();
}

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(html);
}

function sendPdf(res: http.ServerResponse, pdf: Buffer, filename: string): void {
  res.writeHead(200, {
    "content-type": "application/pdf",
    "content-disposition": `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "")}"`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(pdf);
}

function setCookie(name: string, value: string, maxAge: number): string {
  const secure = process.env.COOKIE_SECURE === "1" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

function readCookie(req: http.IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

async function readForm(req: http.IncomingMessage): Promise<URLSearchParams> {
  const body = await readBody(req);
  return new URLSearchParams(body.toString("utf8"));
}

async function readSingleFile(req: http.IncomingMessage): Promise<{ filename: string; data: Buffer }> {
  const type = req.headers["content-type"] ?? "";
  if (!type.includes("multipart/form-data")) throw new HttpError("এক পাতা করে আপলোড করুন।");
  const parts = parseMultipart(await readBody(req), type).filter((part) => part.filename);
  if (parts.length !== 1) throw new HttpError("এক পাতা করে আপলোড করুন।");
  const file = parts[0];
  if (!file || file.data.length === 0) throw new HttpError("ফাইল বেছে নিন।");
  return { filename: file.filename ?? "page", data: file.data };
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY) throw new HttpError("ফাইল অনেক বড়। সর্বোচ্চ ৮ মেগাবাইট।");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

type Part = { name: string; filename?: string; data: Buffer };

function parseMultipart(body: Buffer, contentType: string): Part[] {
  const found = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!found) throw new HttpError("আপলোড পড়া যায়নি।");
  const boundary = Buffer.from(`--${found[1] ?? found[2]}`);
  const parts: Part[] = [];
  let start = body.indexOf(boundary);
  if (start < 0) return parts;
  start += boundary.length;
  while (start < body.length) {
    if (body[start] === 45 && body[start + 1] === 45) break;
    if (body[start] === 13 && body[start + 1] === 10) start += 2;
    const headerEnd = body.indexOf("\r\n\r\n", start);
    if (headerEnd < 0) break;
    const header = body.subarray(start, headerEnd).toString("utf8");
    const dataStart = headerEnd + 4;
    const next = body.indexOf(boundary, dataStart);
    if (next < 0) break;
    let dataEnd = next;
    if (body[dataEnd - 2] === 13 && body[dataEnd - 1] === 10) dataEnd -= 2;
    parts.push({
      name: /name="([^"]*)"/.exec(header)?.[1] ?? "",
      filename: /filename="([^"]*)"/.exec(header)?.[1],
      data: body.subarray(dataStart, dataEnd),
    });
    start = next + boundary.length;
  }
  return parts;
}

function sniff(buf: Buffer): string | undefined {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  return undefined;
}

function safeName(name: string): string {
  return path.basename(name).replace(/[^\w.\- ]+/g, "").slice(0, 80) || "page";
}

function sameText(a: string, b: string): boolean {
  const left = crypto.createHash("sha256").update(a).digest();
  const right = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(left, right);
}

function clientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (raw?.split(",")[0] ?? req.socket.remoteAddress ?? "").trim();
}

function locked(key: string): boolean {
  const row = fails.get(key);
  if (!row) return false;
  if (row.until > Date.now() && row.n >= 8) return true;
  if (row.until <= Date.now()) fails.delete(key);
  return false;
}

function markFail(key: string): void {
  const row = fails.get(key);
  const n = row && row.until > Date.now() ? row.n + 1 : 1;
  fails.set(key, { n, until: Date.now() + 10 * 60 * 1000 });
}

function clearFail(key: string): void {
  fails.delete(key);
}

const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  startServer().then(({ port }) => {
    console.log(`dashboard http://127.0.0.1:${port}`);
  });
}
