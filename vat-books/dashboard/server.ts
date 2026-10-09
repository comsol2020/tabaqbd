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
import { listPersonal, personalFile, personalInline, removePersonal, savePersonal } from "../bot/lib/personal.js";
import { importerPinMatches, operatorPinConfigured, operatorPinMatches, setImporterPin, setOperatorPin } from "../bot/lib/pins.js";
import { monthlyReport, reportHtml } from "../bot/lib/report.js";
import { addCustomers, listBins, loadImporter, loadSharedCustomers, removeCustomer, saveImporter, type Kv } from "../bot/lib/store.js";
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
  const host = opts.host ?? process.env.HOST ?? "0.0.0.0";
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
  if (method === "GET" && url.pathname === "/app") return userInstructions(req, res, url);
  if (method === "GET" && url.pathname === "/app/upload") return userUploadPage(req, res, url);
  if (method === "GET" && url.pathname === "/app/submissions") return userSubmissions(req, res, ctx, url);
  if (method === "GET" && url.pathname === "/app/report") return userReportPage(req, res, url);
  if (method === "GET" && url.pathname === "/app/docs") return userDocsPage(req, res, ctx, url);
  if (method === "POST" && url.pathname === "/app/docs") return userDocsSave(req, res, ctx);
  if (method === "GET" && url.pathname.startsWith("/app/docs/file/")) {
    return sendPersonal(req, res, ctx, url.pathname.slice("/app/docs/file/".length), false, url.searchParams.get("download") === "1");
  }
  if (method === "POST" && url.pathname === "/upload") return userUpload(req, res, ctx);
  if (method === "GET" && url.pathname === "/download") return userDownload(req, res, ctx, url);
  if (method === "GET" && url.pathname.startsWith("/file/")) return sendFile(req, res, ctx, url.pathname.slice("/file/".length), false);
  if (method === "GET" && url.pathname === "/op") return operatorHome(req, res, ctx, url);
  if (method === "GET" && url.pathname === "/op/customer") return operatorCustomer(req, res, ctx, url);
  if (method === "GET" && url.pathname === "/op/book") return operatorBook(req, res, ctx, url);
  if (method === "POST" && url.pathname === "/op/login") return operatorLogin(req, res, ctx);
  if (method === "GET" && url.pathname === "/op/profile") return operatorProfilePage(req, res, url);
  if (method === "POST" && url.pathname === "/op/profile") return operatorProfileSave(req, res, ctx);
  if (method === "POST" && url.pathname === "/op/logout") return logout(res, "opid", "/op");
  if (method === "GET" && url.pathname === "/op/pin") return operatorPinPage(req, res, url);
  if (method === "POST" && url.pathname === "/op/pin") return operatorPin(req, res, ctx);
  if (method === "GET" && url.pathname === "/op/reset") return operatorResetPage(req, res, ctx, url);
  if (method === "POST" && url.pathname === "/op/reset") return operatorReset(req, res, ctx);
  if (method === "GET" && url.pathname === "/op/uploads") return operatorUploadsPage(req, res, ctx, url);
  if (method === "GET" && url.pathname === "/op/docs") return operatorDocsPage(req, res, ctx, url);
  if (method === "POST" && url.pathname === "/op/docs/remove") return operatorDocsRemove(req, res, ctx);
  if (method === "GET" && url.pathname.startsWith("/op/docs/file/")) {
    return sendPersonal(req, res, ctx, url.pathname.slice("/op/docs/file/".length), true, url.searchParams.get("download") === "1");
  }
  if (method === "GET" && url.pathname === "/op/manual") return operatorManualPage(req, res, ctx, url);
  if (method === "POST" && url.pathname === "/op/manual") return operatorManualUpload(req, res, ctx);
  if (method === "GET" && url.pathname === "/op/api") return operatorApiPage(req, res, ctx, url);
  if (method === "GET" && url.pathname === "/op/buyers") return operatorBuyersPage(req, res, ctx, url);
  if (method === "POST" && url.pathname === "/op/buyers") return operatorBuyersAdd(req, res, ctx);
  if (method === "POST" && url.pathname === "/op/buyers/remove") return operatorBuyersRemove(req, res, ctx);
  if (method === "GET" && url.pathname === "/op/monthly") return operatorMonthlyPage(req, res, url);
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
    redirect(res, "/?msg=" + encodeURIComponent("ইউজার আইডি বা পাসওয়ার্ড মিলছে না।"));
    return;
  }
  clearFail(key);
  redirect(res, "/app", { sid: startSession({ kind: "user", bin, exp: Date.now() + DAY_MS }) });
}

async function operatorLogin(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { operatorPin: string; kv: Kv },
): Promise<void> {
  if (!(await operatorPinConfigured(ctx.kv, ctx.operatorPin))) throw new HttpError("OPERATOR_PIN সেট করা নেই।");
  const form = await readForm(req);
  const key = `op|${clientIp(req)}`;
  if (locked(key)) throw new HttpError("অনেকবার ভুল হয়েছে। কিছুক্ষণ পর চেষ্টা করুন।", 429);
  if (!(await operatorPinMatches(ctx.kv, form.get("pin") ?? "", ctx.operatorPin))) {
    markFail(key);
    redirect(res, "/op?msg=" + encodeURIComponent("পাসওয়ার্ড মিলছে না।"));
    return;
  }
  clearFail(key);
  redirect(res, "/op", { opid: startSession({ kind: "operator", exp: Date.now() + DAY_MS }) });
}

async function operatorProfilePage(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  requireOperator(req);
  const body = `
    ${note(url)}
    <section class="card">
      <h2>প্রোফাইল</h2>
      <p class="note">Admin পাসওয়ার্ড এখান থেকে বদলান। ৪ থেকে ৮০ অক্ষর।</p>
      <form method="post" action="/op/profile" class="row">
        <label>এখনকার পাসওয়ার্ড <input name="current" type="password" required autocomplete="current-password"></label>
        <label>নতুন পাসওয়ার্ড <input name="next" type="password" required minlength="4" maxlength="80" autocomplete="new-password"></label>
        <label>আবার <input name="next2" type="password" required minlength="4" maxlength="80" autocomplete="new-password"></label>
        <button>পাসওয়ার্ড বদলান</button>
      </form>
    </section>`;
  sendHtml(res, 200, page("প্রোফাইল", body, { tabs: opTabs("/op/profile") }));
}

async function operatorProfileSave(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { operatorPin: string; kv: Kv },
): Promise<void> {
  requireOperator(req);
  const form = await readForm(req);
  const next = form.get("next") ?? "";
  if (next !== (form.get("next2") ?? "")) throw new HttpError("দুইবারের পাসওয়ার্ড এক নয়।");
  if (!(await operatorPinMatches(ctx.kv, form.get("current") ?? "", ctx.operatorPin))) {
    throw new HttpError("এখনকার পাসওয়ার্ড মিলছে না।");
  }
  await setOperatorPin(ctx.kv, next);
  redirect(res, "/op/profile?msg=" + encodeURIComponent("পাসওয়ার্ড বদলেছে।"));
}

function logout(res: http.ServerResponse, cookie: string, to: string): void {
  const id = "";
  redirect(res, to, { [cookie]: id }, 0);
}

function userPage(title: string, body: string, current: string): string {
  return page(title, body, { nav: userNav(), tabs: userTabs(current), keepTitle: true });
}

async function userInstructions(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  requireUser(req);
  const body = `
    ${note(url)}
    <section class="card">
      <h2>নির্দেশনা</h2>
      <ul>
        <li>ইম্পোর্টারের BIN ও পিন দিয়ে ঢুকুন।</li>
        <li>এক পাতা করে বিল অব এন্ট্রি আপলোড করুন।</li>
        <li>মাস বেছে ৬.১, ৬.২, ৬.৩ ও মাসিক রিপোর্টের পিডিএফ নিন।</li>
        <li>আপলোড কনফার্মের পর খাতায় যায়।</li>
        <li>মূসক ৬.১, ৬.২, ৬.৩ ও মাসিক রিপোর্ট। পোর্টালে কিছু পাঠায় না — ফাইল আপনি ডাউনলোড করবেন।</li>
      </ul>
    </section>`;
  sendHtml(res, 200, userPage("Book of Mushak", body, "/app"));
}

async function userUploadPage(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  requireUser(req);
  const body = `
    ${note(url)}
    <section class="card">
      <h2>বিল অব এন্ট্রি আপলোড</h2>
      <p class="note">এক পাতা করে দিন। কনফার্মের পর খাতায় যাবে।</p>
      <form method="post" action="/upload" enctype="multipart/form-data">
        <input type="file" name="page" accept="image/jpeg,image/png,image/webp,application/pdf" required>
        <button>আপলোড</button>
      </form>
    </section>`;
  sendHtml(res, 200, userPage("Book of Mushak", body, "/app/upload"));
}

async function userSubmissions(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { kv: Kv },
  url: URL,
): Promise<void> {
  const bin = requireUser(req);
  const rows = (await listUploads(ctx.kv, bin))
    .map(
      (row) =>
        `<tr><td>${esc(row.createdAt.slice(0, 16).replace("T", " "))}</td><td>${esc(row.fileName)}</td><td>${esc(statusText(row.status))}</td></tr>`,
    )
    .join("");
  const body = `
    ${note(url)}
    <section class="card">
      <h2>আপনার সাবমিশন</h2>
      <p class="note">এখানে আপনার পাঠানো বিল অব এন্ট্রির তালিকা। সময়, ফাইলের নাম ও অবস্থা। এটা খাতা নয়।</p>
      <table><thead><tr><th>সময়</th><th>ফাইল</th><th>অবস্থা</th></tr></thead><tbody>${rows || `<tr><td colspan="3">এখনো কোনো আপলোড নেই।</td></tr>`}</tbody></table>
    </section>`;
  sendHtml(res, 200, userPage("Book of Mushak", body, "/app/submissions"));
}

async function userReportPage(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  requireUser(req);
  const body = `
    ${note(url)}
    <section class="card">
      <h2>রিপোর্ট</h2>
      <form method="get" action="/download" class="report">
        <label>মাস <input type="month" name="month" required></label>
        <div class="row">
          <button name="form" value="4.3" formnovalidate>৪.৩</button>
          <button name="form" value="6.1">৬.১</button>
          <button name="form" value="6.2">৬.২</button>
          <button name="form" value="6.3">৬.৩</button>
          <button name="form" value="report">মাসিক রিপোর্ট</button>
        </div>
      </form>
      <p class="note">৪.৩ মাস চায় না। ৬.১, ৬.২, ৬.৩ ও মাসিক রিপোর্টের আগে মাস বেছে নিন।</p>
    </section>`;
  sendHtml(res, 200, userPage("Book of Mushak", body, "/app/report"));
}

async function userDocsPage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { kv: Kv },
  url: URL,
): Promise<void> {
  const bin = requireUser(req);
  const rows = (await listPersonal(ctx.kv, bin))
    .map(
      (row) =>
        `<tr><td>${esc(row.createdAt.slice(0, 16).replace("T", " "))}</td><td>${esc(row.fileName)}</td><td>পাঠানো হয়েছে</td></tr>`,
    )
    .join("");
  const body = `
    ${note(url)}
    <section class="card">
      <h2>পারসোনাল ডকুমেন্ট</h2>
      <p class="note">যেকোনো ফাইল এখান থেকে পাঠান। Admin দেখে ডাউনলোড বা ডিলিট করবেন। এক ফাইলে সর্বোচ্চ ৮ মেগাবাইট।</p>
      <form method="post" action="/app/docs" enctype="multipart/form-data">
        <input type="file" name="file" required>
        <button>পাঠান</button>
      </form>
      <table><thead><tr><th>সময়</th><th>ফাইল</th><th>অবস্থা</th></tr></thead><tbody>${rows || `<tr><td colspan="3">এখনো কোনো ডকুমেন্ট পাঠানো হয়নি।</td></tr>`}</tbody></table>
    </section>`;
  sendHtml(res, 200, userPage("Book of Mushak", body, "/app/docs"));
}

async function userDocsSave(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { dataDir: string; kv: Kv },
): Promise<void> {
  const bin = requireUser(req);
  const file = await readSingleFile(req);
  await savePersonal(ctx.kv, ctx.dataDir, { bin, fileName: file.filename, data: file.data });
  redirect(res, "/app/docs?msg=" + encodeURIComponent("ডকুমেন্ট পাঠানো হয়েছে।"));
}

async function userUpload(req: http.IncomingMessage, res: http.ServerResponse, ctx: { dataDir: string; kv: Kv }): Promise<void> {
  const bin = requireUser(req);
  const file = await readSingleFile(req);
  const type = sniff(file.data);
  if (!type) throw new HttpError("শুধু JPG, PNG, WEBP বা এক পাতার PDF দেওয়া যাবে।");
  await saveUpload(ctx.kv, ctx.dataDir, { bin, fileName: safeName(file.filename), contentType: type, data: file.data });
  redirect(res, "/app/submissions?msg=" + encodeURIComponent("আপলোড হয়েছে। কনফার্মের পর খাতায় যাবে।"));
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
  const name = form === "report" ? `report-${month}.pdf` : form === "4.3" ? "mushak-4.3.pdf" : `mushak-${form}-${month}.pdf`;
  sendPdf(res, pdf, name);
}

async function operatorHome(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { operatorPin: string; kv: Kv },
  url: URL,
): Promise<void> {
  if (!operatorSession(req)) {
    return sendHtml(res, 200, operatorLoginPage(url.searchParams.get("msg"), await operatorPinConfigured(ctx.kv, ctx.operatorPin)));
  }
  const rows = await customerRows(ctx.kv);
  const bodyRows = rows
    .map(
      (row) =>
        `<tr><td>${esc(row.name)}</td><td>${esc(row.bin)}</td><td><a class="btn" href="/op/customer?bin=${esc(row.bin)}">খুলুন</a></td></tr>`,
    )
    .join("");
  const body = `
    ${note(url)}
    <section class="card">
      <h2>কাস্টমার</h2>
      <table><thead><tr><th>প্রতিষ্ঠানের নাম</th><th>BIN</th><th></th></tr></thead>
      <tbody>${bodyRows || `<tr><td colspan="3">এখনো কোনো কাস্টমার নেই। ইউজার পিন পাতায় নাম দিয়ে যোগ করুন।</td></tr>`}</tbody></table>
    </section>`;
  sendHtml(res, 200, page("Admin", body, { tabs: opTabs("/op") }));
}

async function operatorCustomer(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { kv: Kv },
  url: URL,
): Promise<void> {
  requireOperator(req);
  const bin = normalizeBin(url.searchParams.get("bin") ?? "");
  const row = (await customerRows(ctx.kv)).find((item) => item.bin === bin);
  if (!row) throw new HttpError("এই কাস্টমারের নাম নেই।", 404);
  const body = `
    ${note(url)}
    <section class="card">
      <h2>${esc(row.name)}</h2>
      <p>BIN <strong>${esc(row.bin)}</strong></p>
      <p>প্রতিষ্ঠানের নাম <strong>${esc(row.name)}</strong></p>
      <form method="get" action="/op/book" class="row">
        <input type="hidden" name="bin" value="${esc(row.bin)}">
        <label>মাস <input type="month" name="month" required></label>
        <button name="form" value="4.3" formnovalidate>৪.৩</button>
        <button name="form" value="6.1">৬.১</button>
        <button name="form" value="6.2">৬.২</button>
        <button name="form" value="6.3">৬.৩</button>
        <button name="form" value="report">Report</button>
      </form>
    </section>`;
  sendHtml(res, 200, page(row.name, body, { tabs: opTabs("/op") }));
}

async function operatorBook(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { kv: Kv },
  url: URL,
): Promise<void> {
  requireOperator(req);
  const bin = normalizeBin(url.searchParams.get("bin") ?? "");
  const month = url.searchParams.get("month") ?? "";
  const form = url.searchParams.get("form") ?? "";
  const html = await bookHtml(await loadImporter(ctx.kv, bin), bin, month, form);
  const pdf = await htmlToPdf(html);
  const name = form === "report" ? `report-${bin}-${month}.pdf` : form === "4.3" ? `mushak-4.3-${bin}.pdf` : `mushak-${form}-${month}.pdf`;
  sendPdf(res, pdf, name);
}

async function operatorResetPage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { kv: Kv },
  url: URL,
): Promise<void> {
  requireOperator(req);
  const options = (await listBins(ctx.kv)).map((bin) => `<option value="${esc(bin)}">`).join("");
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
    </section>`;
  sendHtml(res, 200, page("মাস্টার রিসেট", body, { tabs: opTabs("/op/reset") }));
}

async function operatorUploadsPage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { kv: Kv },
  url: URL,
): Promise<void> {
  requireOperator(req);
  const uploads = (await listUploads(ctx.kv)).filter((row) => row.status === "pending");
  const uploadRows = uploads
    .map((row) => {
      const preview =
        row.contentType.startsWith("image/")
          ? `<img alt="" src="/op/file/${esc(row.id)}" style="max-width:180px;max-height:120px">`
          : `<a href="/op/file/${esc(row.id)}">PDF</a>`;
      return `<tr><td>${esc(row.bin)}</td><td>${esc(row.entryDate ?? "—")}</td><td>${esc(row.fileName)}<br>${preview}</td><td>
        <form method="post" action="/op/upload/confirm"><input type="hidden" name="id" value="${esc(row.id)}"><button>কনফার্ম</button></form>
      </td></tr>`;
    })
    .join("");
  const body = `
    ${note(url)}
    <section class="card">
      <h2>আপলোড কনফার্ম</h2>
      <p class="note">কনফার্মের আগে খাতায় যায় না। কনফার্মের পর এজেন্ট পড়ে সেভ করলে সংখ্যা বসবে।</p>
      <table><thead><tr><th>BIN</th><th>তারিখ</th><th>পাতা</th><th></th></tr></thead><tbody>${uploadRows || `<tr><td colspan="4">অপেক্ষমাণ আপলোড নেই।</td></tr>`}</tbody></table>
    </section>`;
  sendHtml(res, 200, page("আপলোড", body, { tabs: opTabs("/op/uploads") }));
}

async function operatorDocsPage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { kv: Kv },
  url: URL,
): Promise<void> {
  requireOperator(req);
  const names = new Map((await customerRows(ctx.kv)).map((row) => [row.bin, row.name]));
  const rows = (await listPersonal(ctx.kv))
    .map((row) => {
      const view = personalInline(row.contentType)
        ? `<a href="/op/docs/file/${esc(row.id)}" target="_blank">দেখুন</a>`
        : `<a href="/op/docs/file/${esc(row.id)}?download=1">দেখুন</a>`;
      return `<tr><td>${esc(row.createdAt.slice(0, 16).replace("T", " "))}</td><td>${esc(names.get(row.bin) ?? row.bin)}</td><td>${esc(row.bin)}</td><td>${esc(row.fileName)}</td><td>${view} <a href="/op/docs/file/${esc(row.id)}?download=1">ডাউনলোড</a>
        <form method="post" action="/op/docs/remove"><input type="hidden" name="id" value="${esc(row.id)}"><button class="danger">ডিলিট</button></form>
      </td></tr>`;
    })
    .join("");
  const body = `
    ${note(url)}
    <section class="card">
      <h2>পারসোনাল ডকুমেন্ট</h2>
      <p class="note">কাস্টমার যে ফাইল পাঠিয়েছেন। দেখে ডাউনলোড বা ডিলিট করুন।</p>
      <table><thead><tr><th>সময়</th><th>কাস্টমার</th><th>BIN</th><th>ফাইল</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="5">এখনো কোনো ডকুমেন্ট আসেনি।</td></tr>`}</tbody></table>
    </section>`;
  sendHtml(res, 200, page("পারসোনাল ডকুমেন্ট", body, { tabs: opTabs("/op/docs") }));
}

async function operatorDocsRemove(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { dataDir: string; kv: Kv },
): Promise<void> {
  requireOperator(req);
  const form = await readForm(req);
  const doc = await removePersonal(ctx.kv, ctx.dataDir, form.get("id") ?? "");
  redirect(res, "/op/docs?msg=" + encodeURIComponent(`${doc.fileName} মুছে ফেলা হয়েছে।`));
}

async function sendPersonal(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { dataDir: string; kv: Kv },
  id: string,
  operator: boolean,
  download: boolean,
): Promise<void> {
  const doc = (await listPersonal(ctx.kv)).find((row) => row.id === id);
  if (!doc) throw new HttpError("ফাইল নেই।", 404);
  if (operator) requireOperator(req);
  else if (requireUser(req) !== doc.bin) throw new HttpError("এই ফাইল আপনার নয়।", 403);
  const data = await fs.readFile(personalFile(ctx.dataDir, id));
  const inline = personalInline(doc.contentType) && !download;
  const type = inline ? doc.contentType : "application/octet-stream";
  const star = encodeURIComponent(doc.fileName);
  res.writeHead(200, {
    "content-type": type,
    "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${star}`,
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store",
  });
  res.end(data);
}

async function operatorManualPage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { kv: Kv },
  url: URL,
): Promise<void> {
  requireOperator(req);
  const rows = (await listUploads(ctx.kv))
    .filter((row) => row.entryDate)
    .map(
      (row) =>
        `<tr><td>${esc(row.createdAt.slice(0, 16).replace("T", " "))}</td><td>${esc(row.bin)}</td><td>${esc(row.entryDate)}</td><td>${esc(row.fileName)}</td><td>${esc(statusText(row.status))}</td></tr>`,
    )
    .join("");
  const body = `
    ${note(url)}
    <section class="card">
      <h2>ম্যানুয়াল এন্ট্রি</h2>
      <p class="note">যে তারিখ দেবেন, বিল অব এন্ট্রির তারিখ সেটাই হবে। কনফার্মের পর খাতায় যাবে।</p>
      <form method="post" action="/op/manual" enctype="multipart/form-data" class="row">
        <label>BIN <input name="bin" required inputmode="numeric"></label>
        <label>তারিখ <input name="date" type="date" required></label>
        <label>বিল অব এন্ট্রি <input type="file" name="page" accept="image/jpeg,image/png,image/webp,application/pdf" required></label>
        <button>আপলোড</button>
      </form>
    </section>
    <section class="card">
      <h2>দেওয়া এন্ট্রি</h2>
      <table><thead><tr><th>সময়</th><th>BIN</th><th>তারিখ</th><th>ফাইল</th><th>অবস্থা</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5">এখনো কোনো ম্যানুয়াল এন্ট্রি নেই।</td></tr>`}</tbody></table>
    </section>`;
  sendHtml(res, 200, page("ম্যানুয়াল এন্ট্রি", body, { tabs: opTabs("/op/manual") }));
}

async function operatorManualUpload(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { dataDir: string; kv: Kv },
): Promise<void> {
  requireOperator(req);
  const form = await readManualUpload(req);
  const bin = normalizeBin(form.bin);
  const type = sniff(form.file.data);
  if (!type) throw new HttpError("শুধু JPG, PNG, WEBP বা এক পাতার PDF দেওয়া যাবে।");
  await saveUpload(ctx.kv, ctx.dataDir, {
    bin,
    fileName: safeName(form.file.filename),
    contentType: type,
    data: form.file.data,
    entryDate: form.date,
  });
  redirect(res, "/op/manual?msg=" + encodeURIComponent(`আপলোড হয়েছে। তারিখ ${form.date}। কনফার্মের পর খাতায় যাবে।`));
}

async function operatorPinPage(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  requireOperator(req);
  const body = `
    ${note(url)}
    <section class="card">
      <h2>ইউজার পিন</h2>
      <p class="note">পিন ১১ সংখ্যার নম্বর। নাম দিলে কাস্টমার তালিকায় যোগ হয়।</p>
      <form method="post" action="/op/pin" class="row">
        <label>প্রতিষ্ঠানের নাম <input name="name" required></label>
        <label>BIN <input name="bin" required></label>
        <label>পিন <input name="pin" required inputmode="numeric" minlength="11" maxlength="11" pattern="[0-9]{11}"></label>
        <label>আবার <input name="pin2" required inputmode="numeric" minlength="11" maxlength="11" pattern="[0-9]{11}"></label>
        <button>পিন সেট</button>
      </form>
    </section>`;
  sendHtml(res, 200, page("ইউজার পিন", body, { tabs: opTabs("/op/pin") }));
}

async function operatorApiPage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { kv: Kv },
  url: URL,
): Promise<void> {
  requireOperator(req);
  const apis = await listApis(ctx.kv);
  const apiRows = apis
    .map(
      (row) =>
        `<tr><td>${esc(row.label)}</td><td>${esc(row.id)}</td><td>${esc(row.baseUrl)}</td><td>${esc(row.apiKeyEnv)}</td><td>${esc(row.note)}</td><td>
          <form method="post" action="/op/api/remove"><input type="hidden" name="id" value="${esc(row.id)}"><button>সরান</button></form>
        </td></tr>`,
    )
    .join("");
  const body = `
    ${note(url)}
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
  sendHtml(res, 200, page("API", body, { tabs: opTabs("/op/api") }));
}

async function operatorPin(req: http.IncomingMessage, res: http.ServerResponse, ctx: { kv: Kv }): Promise<void> {
  requireOperator(req);
  const form = await readForm(req);
  if ((form.get("pin") ?? "") !== (form.get("pin2") ?? "")) throw new HttpError("দুইবারের পিন এক নয়।");
  const bin = await setImporterPin(ctx.kv, form.get("bin") ?? "", form.get("pin") ?? "");
  const name = (form.get("name") ?? "").trim().slice(0, 120);
  if (name) await saveAdminCustomer(ctx.kv, bin, name);
  redirect(res, "/op/pin?msg=" + encodeURIComponent(`BIN ${bin}-এর পিন সেট হয়েছে।`));
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
    sendHtml(res, 200, page("কনফার্মেশন", resetConfirmHtml(preview), { tabs: opTabs("/op/reset") }));
    return;
  }
  if (confirm !== preview.phrase) throw new HttpError("কনফার্মেশন মেলেনি। কিছু মুছে ফেলা হয়নি।");
  applyReset(doc, month);
  await saveImporter(ctx.kv, doc);
  await recordDeletion(ctx.kv, bin, month);
  redirect(res, "/op/reset?msg=" + encodeURIComponent(`${bin} এর ${month} মাস মুছে ফেলা হয়েছে।`));
}

async function operatorBuyersPage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { kv: Kv },
  url: URL,
): Promise<void> {
  requireOperator(req);
  const bin = (url.searchParams.get("bin") ?? "").trim();
  const options = await Promise.all(
    (await listBins(ctx.kv)).map(async (item) => {
      const name = (await loadImporter(ctx.kv, item))?.name ?? item;
      const selected = item === bin ? " selected" : "";
      return `<option value="${esc(item)}"${selected}>${esc(name)} — ${esc(item)}</option>`;
    }),
  );
  let missing = "";
  let customers: { id: string; name: string; address: string; bin?: string; nid?: string }[] = [];
  if (bin) {
    const doc = await loadImporter(ctx.kv, bin);
    if (!doc) missing = "এই BIN-এর বই এখনো নেই। আগে একটি বিল সেভ করতে হবে।";
    else customers = doc.customers;
  } else {
    customers = await loadSharedCustomers(ctx.kv);
  }
  const rows = customers
    .map(
      (row) => `<tr><td>${esc(row.name)}</td><td>${esc(row.address)}</td><td>${esc(row.bin ?? "")}</td><td>${esc(row.nid ?? "")}</td><td>
        <form method="post" action="/op/buyers/remove"><input type="hidden" name="for" value="${esc(bin)}"><input type="hidden" name="id" value="${esc(row.id)}"><button class="danger">সরান</button></form>
      </td></tr>`,
    )
    .join("");
  const body = `
    ${note(url)}
    <section class="card">
      <h2>৬.৩ ক্রেতা</h2>
      <p class="note">এই তালিকা থেকে ৬.৩ চালানের ক্রেতা বাছাই হয়। সবার তালিকা শুধু এরপর নতুন ইম্পোর্টারে বসে। পুরনো ইম্পোর্টারের জন্য তার নাম বেছে নিন।</p>
      <form method="get" action="/op/buyers" class="row">
        <label>তালিকা
          <select name="bin">
            <option value="">সবার তালিকা</option>
            ${options.join("")}
          </select>
        </label>
        <button>দেখুন</button>
      </form>
      ${missing ? `<p>${esc(missing)}</p>` : ""}
    </section>
    <section class="card">
      <h2>একজন যোগ</h2>
      <form method="post" action="/op/buyers" class="row">
        <input type="hidden" name="for" value="${esc(bin)}">
        <label>নাম <input name="name" required></label>
        <label>ঠিকানা <input name="address"></label>
        <label>BIN <input name="buyerBin"></label>
        <label>NID <input name="nid"></label>
        <button>যোগ</button>
      </form>
    </section>
    <section class="card">
      <h2>অনেকজন একসাথে</h2>
      <p class="note">এক্সেল থেকে কপি করে আটকান। প্রতি লাইনে নাম, ঠিকানা, BIN, NID। কলাম ট্যাব বা কমা দিয়ে আলাদা।</p>
      <form method="post" action="/op/buyers">
        <input type="hidden" name="for" value="${esc(bin)}">
        <label>তালিকা <textarea name="lines" rows="8" required></textarea></label>
        <button>তালিকা যোগ</button>
      </form>
    </section>
    <section class="card">
      <h2>এখনকার তালিকা (${customers.length})</h2>
      <table><thead><tr><th>নাম</th><th>ঠিকানা</th><th>BIN</th><th>NID</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5">এখনো কোনো ক্রেতা নেই।</td></tr>`}</tbody></table>
    </section>`;
  sendHtml(res, 200, page("৬.৩ ক্রেতা", body, { tabs: opTabs("/op/buyers") }));
}

async function operatorBuyersAdd(req: http.IncomingMessage, res: http.ServerResponse, ctx: { kv: Kv }): Promise<void> {
  requireOperator(req);
  const form = await readForm(req);
  const owner = (form.get("for") ?? "").trim();
  const lines = form.get("lines");
  const customers = lines !== null ? parseCustomerLines(lines) : [{
    name: form.get("name") ?? "",
    address: form.get("address") ?? "",
    bin: form.get("buyerBin") ?? "",
    nid: form.get("nid") ?? "",
  }];
  if (customers.length === 0 || customers.every((row) => !row.name.trim())) throw new HttpError("ক্রেতার নাম দিন।");
  const result = await addCustomers(ctx.kv, owner || undefined, customers);
  const where = result.list === "shared" ? "সবার তালিকায়" : `BIN ${result.list}-এ`;
  redirect(res, buyersLocation(owner, `${where} ${result.added} জন যোগ হয়েছে। ${result.skipped} জন আগেই ছিল।`));
}

async function operatorBuyersRemove(req: http.IncomingMessage, res: http.ServerResponse, ctx: { kv: Kv }): Promise<void> {
  requireOperator(req);
  const form = await readForm(req);
  const owner = (form.get("for") ?? "").trim();
  await removeCustomer(ctx.kv, owner || undefined, form.get("id") ?? "");
  redirect(res, buyersLocation(owner, "ক্রেতা সরানো হয়েছে।"));
}

function buyersLocation(owner: string, msg: string): string {
  const bin = owner ? `?bin=${encodeURIComponent(owner)}&` : "?";
  return `/op/buyers${bin}msg=${encodeURIComponent(msg)}`;
}

function parseCustomerLines(text: string): { name: string; address: string; bin?: string; nid?: string }[] {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\t|,/).map((part) => part.trim());
    const [name, address, bin, nid] = parts;
    if (!name) continue;
    rows.push({ name, address: address ?? "", bin: bin || undefined, nid: nid || undefined });
  }
  return rows;
}

async function operatorMonthlyPage(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  requireOperator(req);
  const body = `
    ${note(url)}
    <section class="card">
      <h2>মাসিক রিপোর্ট</h2>
      <form method="get" action="/op/parties" class="row">
        <label>মাস <input type="month" name="month" required></label>
        <button>Report</button>
      </form>
    </section>`;
  sendHtml(res, 200, page("Report", body, { tabs: opTabs("/op/monthly") }));
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
  sendHtml(res, 200, page("Report", body, { tabs: opTabs("/op/monthly") }));
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
  redirect(res, "/op/uploads?msg=" + encodeURIComponent(`BIN ${upload.bin}-এর পাতা কনফার্ম হয়েছে। এজেন্ট সেভ করলে খাতায় বসবে।`));
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
  redirect(res, "/op/api?msg=" + encodeURIComponent(`API ${entry.label} যোগ হয়েছে। কল করা হয়নি।`));
}

async function operatorRemoveApi(req: http.IncomingMessage, res: http.ServerResponse, ctx: { kv: Kv }): Promise<void> {
  requireOperator(req);
  const form = await readForm(req);
  await removeApi(ctx.kv, form.get("id") ?? "");
  redirect(res, "/op/api?msg=" + encodeURIComponent("API সরানো হয়েছে।"));
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
  if (form === "4.3") {
    if (!doc) return emptyBook(bin, "", "এখনো ৪.৩ ঘোষণা নেই।");
    return toHtml(buildBook(doc, "4.3"));
  }
  if (!month) throw new HttpError("মাস বেছে নিন।");
  assertMonth(month);
  if (form !== "report" && form !== "6.1" && form !== "6.2" && form !== "6.3") {
    throw new HttpError("বই ৪.৩, ৬.১, ৬.২, ৬.৩ বা রিপোর্ট।");
  }
  if (!doc) return emptyBook(bin, month);
  if (form === "report") return reportHtml(monthlyReport(doc, month));
  return toHtml(buildBook(doc, form as FormId, monthRange(month)));
}

function resetConfirmHtml(preview: ReturnType<typeof previewReset>): string {
  if (preview.empty) {
    return `<section class="card"><p>${esc(preview.bin)} এর ${esc(preview.month)} মাসে মুছার মতো কিছু নেই।</p><p><a href="/op/reset">ফিরে যান</a></p></section>`;
  }
  if (preview.blocked.length > 0) {
    const items = preview.blocked.map((row) => `<li>${esc(row.challanNo)} — ${esc(row.issueDate)}</li>`).join("");
    return `<section class="card"><p>এই মাসের বিলের চালান অন্য মাসে আছে, তাই মুছা হয়নি।</p><ul>${items}</ul><p><a href="/op/reset">ফিরে যান</a></p></section>`;
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
      <a class="btn" href="/op/reset">বাতিল</a>
    </form>
  </section>`;
}

function statusText(status: string): string {
  if (status === "pending") return "অপেক্ষমাণ — কনফার্মের পর খাতায় যাবে";
  if (status === "confirmed") return "কনফার্ম হয়েছে — খাতায় তোলা হচ্ছে";
  return "খাতায় আছে";
}

function emptyBook(bin: string, month: string, message = ""): string {
  const text = message || `${month} মাসে এখনো কোনো হিসাব নেই।`;
  return `<!doctype html><html lang="bn"><head><meta charset="utf-8"><title>খালি</title></head><body><p>BIN ${esc(bin)} — ${esc(text)}</p></body></html>`;
}

function withBar(html: string, href: string): string {
  const bar = `<p style="font-family:sans-serif"><a href="${esc(href)}">পিডিএফ ডাউনলোড</a></p>`;
  return html.includes("<body>") ? html.replace("<body>", `<body>${bar}`) : bar + html;
}

function loginPage(msg: string | null): string {
  return page(
    "প্রবেশ",
    `${msg ? `<p class="note">${esc(msg)}</p>` : ""}
    <section class="card login-card">
      <h2>প্রবেশ</h2>
      <form method="post" action="/login" class="stack">
        <label>ইউজার আইডি
          <input name="bin" required autocomplete="username" inputmode="numeric" minlength="13" maxlength="13" pattern="[0-9]{13}" placeholder="১৩ সংখ্যার বিন নম্বর">
          <span class="hint">ইউজার আইডি আপনার বিন নম্বর।</span>
        </label>
        <label>পাসওয়ার্ড
          <input name="pin" type="password" required inputmode="numeric" minlength="11" maxlength="11" pattern="[0-9]{11}" autocomplete="current-password" placeholder="১১ সংখ্যা">
          <span class="hint">পাসওয়ার্ড ১১ সংখ্যার সংখ্যা।</span>
        </label>
        <button>ঢুকুন</button>
      </form>
    </section>`,
    { slogan: "অনলাইনে ভ্যাট দাখিল করুন, জরিমানা এড়াতে সঠিকভাবে খাতা সংরক্ষণ করুন" },
  );
}

function operatorLoginPage(msg: string | null, configured: boolean): string {
  if (!configured) return page("Admin", "<p>OPERATOR_PIN সেট করা নেই।</p>");
  return page(
    "Admin",
    `${msg ? `<p class="note">${esc(msg)}</p>` : ""}
    <section class="card"><form method="post" action="/op/login" class="row">
      <label>পাসওয়ার্ড <input name="pin" type="password" required></label>
      <button>প্রবেশ</button>
    </form></section>`,
  );
}

function userNav(): string {
  return `<form method="post" action="/logout"><button translate="no">Sign Out</button></form>`;
}

function userTabs(current: string): string {
  const item = (href: string, label: string) =>
    `<a href="${href}"${current === href ? ' class="on"' : ""}>${label}</a>`;
  return `<nav class="tabs">${item("/app", "নির্দেশনা")}${item("/app/upload", "বিল অব এন্ট্রি আপলোড")}${item("/app/submissions", "আপনার সাবমিশন")}${item("/app/docs", "পারসোনাল ডকুমেন্ট")}${item("/app/report", "রিপোর্ট")}</nav>`;
}

function opTabs(current: string): string {
  const item = (href: string, label: string) =>
    `<a href="${href}"${current === href ? ' class="on"' : ""}>${label}</a>`;
  return `<nav class="tabs">${item("/op", "কাস্টমার")}${item("/op/buyers", "৬.৩ ক্রেতা")}${item("/op/monthly", "Report")}${item("/op/reset", "মাস্টার রিসেট")}${item("/op/uploads", "আপলোড")}${item("/op/docs", "পারসোনাল ডকুমেন্ট")}${item("/op/manual", "ম্যানুয়াল এন্ট্রি")}${item("/op/pin", "ইউজার পিন")}${item("/op/api", "API")}${item("/op/profile", "প্রোফাইল")}<form method="post" action="/op/logout"><button>Signout</button></form></nav>`;
}

type NamedCustomer = { bin: string; name: string };

async function loadAdminCustomers(kv: Kv): Promise<NamedCustomer[]> {
  const value = await kv.get("admin:customers");
  if (!Array.isArray(value)) return [];
  const rows: NamedCustomer[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const bin = "bin" in item && typeof item.bin === "string" ? item.bin : "";
    const name = "name" in item && typeof item.name === "string" ? item.name.trim() : "";
    if (bin && name) rows.push({ bin, name });
  }
  return rows;
}

async function saveAdminCustomer(kv: Kv, bin: string, name: string): Promise<void> {
  const rows = (await loadAdminCustomers(kv)).filter((row) => row.bin !== bin);
  rows.push({ bin, name });
  rows.sort((a, b) => a.name.localeCompare(b.name, "bn") || a.bin.localeCompare(b.bin));
  await kv.put("admin:customers", rows as unknown as Parameters<Kv["put"]>[1]);
}

async function customerRows(kv: Kv): Promise<NamedCustomer[]> {
  const byBin = new Map<string, string>();
  for (const row of await loadAdminCustomers(kv)) byBin.set(row.bin, row.name);
  for (const bin of await listBins(kv)) {
    if (byBin.get(bin)) continue;
    const name = (await loadImporter(kv, bin))?.name?.trim();
    if (name) byBin.set(bin, name);
  }
  return [...byBin.entries()]
    .map(([bin, name]) => ({ bin, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "bn") || a.bin.localeCompare(b.bin));
}

function note(url: URL): string {
  const msg = url.searchParams.get("msg");
  return msg ? `<p class="note">${esc(msg)}</p>` : "";
}

function page(title: string, body: string, opts: { nav?: string; slogan?: string; tabs?: string; keepTitle?: boolean } = {}): string {
  const nav = opts.nav ?? "";
  const heading = opts.keepTitle ? `<h1 translate="no">${esc(title)}</h1>` : `<h1>${esc(title)}</h1>`;
  const head = opts.slogan
    ? `<header class="hero"><h1 class="slogan">${esc(opts.slogan)}</h1></header>`
    : `<header class="bar"><div><p class="brand"><a href="/">ভ্যাট অনলাইন</a><span>osbdsyl.online</span></p>${heading}</div>${nav ? `<nav>${nav}</nav>` : ""}</header>`;
  return `<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="description" content="osbdsyl.online — অনলাইনে ভ্যাট দাখিল ও খাতা সংরক্ষণ"><title>${esc(title)} — osbdsyl.online</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
      :root{--green:#0c6b3d;--green-mid:#1e8c4d;--ink:#222;--muted:#555;--line:#dedede;--bg:#f2f2f2}
      body{font-family:"Noto Sans Bengali","Nirmala UI","Vrinda",sans-serif;margin:0;color:var(--ink);min-height:100vh;background:var(--bg);display:flex;flex-direction:column}
      .top{background:var(--green);color:#fff}
      header{max-width:960px;margin:0 auto;padding:16px 22px}
      header.bar{display:flex;justify-content:space-between;align-items:center;gap:16px}
      .brand{margin:0;font-weight:700}
      .brand a{color:#fff;text-decoration:none}
      .brand span{display:block;margin-top:2px;font-weight:400;font-size:.82rem;opacity:.9}
      h1{font-size:1.25rem;margin:4px 0 0;font-weight:600}
      header.hero{text-align:center;padding-top:22px;padding-bottom:22px}
      h1.slogan{font-size:clamp(1.55rem,3.5vw,2.3rem);line-height:1.4;font-weight:700;max-width:18em;margin:8px auto}
      nav{display:flex;gap:12px;align-items:center}
      nav a{color:#fff;text-decoration:none;font-weight:600}
      .tabs{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;background:#fff;border-bottom:1px solid var(--line);padding:0 22px}
      .tabs a{color:var(--green);padding:12px 12px;border-bottom:3px solid transparent}
      .tabs a.on{border-bottom-color:var(--green);font-weight:700}
      .tabs form{margin-left:auto}
      .tabs button{background:var(--green);color:#fff;margin:8px 0}
      a{color:var(--green)}
      main{max-width:960px;width:100%;margin:0 auto;padding:8px 22px 28px;box-sizing:border-box;flex:1}
      button,.btn{background:var(--green-mid);color:#fff;border:0;border-radius:2px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block}
      button:hover,.btn:hover{background:var(--green)}
      button.danger{background:#c44747}
      button.danger:hover{background:#a33636}
      nav button{background:#fff;color:var(--green)}
      table{border-collapse:collapse;width:100%;background:#fff}
      th,td{border:1px solid var(--line);padding:8px;text-align:left;vertical-align:top}
      th{background:#f4faf6;color:var(--green)}
      form.row,div.row{display:flex;gap:10px;flex-wrap:wrap;align-items:end}
      form.report{display:flex;flex-direction:column;gap:12px;align-items:flex-start}
      header form{display:inline}
      label{display:flex;flex-direction:column;gap:6px;font-weight:600}
      .hint{font-weight:400;color:var(--muted);font-size:.84rem}
      input,textarea,select{font:inherit;font-weight:400;padding:10px 12px;border:1px solid #c8c8c8;border-radius:2px;background:#fff;color:var(--ink)}
      textarea{width:100%;box-sizing:border-box}
      input:focus{outline:2px solid var(--green-mid);border-color:var(--green-mid)}
      .card{background:#fff;border:1px solid #e4e4e4;padding:0 0 16px;margin:16px 0}
      .card h2{margin:0 0 14px;padding:12px 16px;background:var(--green-mid);color:#fff;font-size:1.02rem;font-weight:600}
      .card p,.card form,.card ul{padding:0 16px}
      .card ul{padding-left:36px}
      .card table{width:calc(100% - 32px);margin:0 16px}
      .login-card{max-width:420px;margin:28px auto}
      form.stack{display:flex;flex-direction:column;gap:14px}
      form.stack button{align-self:center;min-width:148px}
      .note{color:var(--muted)}
      footer{background:var(--green);color:#fff;font-size:.85rem;padding:14px 22px}
      footer p{max-width:960px;margin:0 auto}
      @media (max-width:640px){header.bar{align-items:center;gap:12px} header.bar h1{font-size:1.05rem}}
    </style></head><body>
    <div class="top">${head}</div>
    ${opts.tabs ?? ""}
    <main>${body}</main>
    <footer><p>osbdsyl.online</p></footer>
    </body></html>`;
}

function requireUser(req: http.IncomingMessage): string {
  const session = sessionFrom(req, "sid");
  if (!session || session.kind !== "user") throw new HttpError("আগে BIN ও পিন দিয়ে ঢুকুন।", 401);
  return session.bin;
}

function requireOperator(req: http.IncomingMessage): void {
  if (!operatorSession(req)) throw new HttpError("Admin হিসেবে ঢুকুন।", 401);
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

async function readManualUpload(req: http.IncomingMessage): Promise<{ bin: string; date: string; file: { filename: string; data: Buffer } }> {
  const type = req.headers["content-type"] ?? "";
  if (!type.includes("multipart/form-data")) throw new HttpError("এক পাতা করে আপলোড করুন।");
  const parts = parseMultipart(await readBody(req), type);
  const files = parts.filter((part) => part.filename);
  if (files.length !== 1) throw new HttpError("এক পাতা করে আপলোড করুন।");
  const file = files[0];
  if (!file || file.data.length === 0) throw new HttpError("ফাইল বেছে নিন।");
  const text = (name: string) => parts.find((part) => part.name === name && !part.filename)?.data.toString("utf8").trim() ?? "";
  return { bin: text("bin"), date: text("date"), file: { filename: file.filename ?? "page", data: file.data } };
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
  if (process.env.TRUST_PROXY === "1") {
    const forwarded = req.headers["x-forwarded-for"];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const ip = raw?.split(",")[0]?.trim();
    if (ip) return ip;
  }
  return (req.socket.remoteAddress ?? "").trim();
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
    const shown = process.env.HOST ?? "0.0.0.0";
    console.log(`dashboard http://${shown}:${port}`);
  });
}
