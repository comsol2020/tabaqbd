import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Print HTML to PDF with headless Chrome, then stop Chrome. It does not exit on its own here. */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vatpdf-"));
  const htmlPath = path.join(dir, "doc.html");
  const pdfPath = path.join(dir, "doc.pdf");
  const profile = path.join(dir, "profile");
  await fs.writeFile(htmlPath, html, "utf8");
  const chrome = process.env.CHROME_PATH || "google-chrome";
  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-sync",
      "--no-first-run",
      "--disable-extensions",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`,
      htmlPath,
    ],
    { detached: true, stdio: "ignore" },
  );
  child.on("error", () => undefined);
  child.unref();
  try {
    const pdf = await waitForPdf(pdfPath);
    return pdf;
  } finally {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function waitForPdf(pdfPath: string): Promise<Buffer> {
  const started = Date.now();
  let lastSize = -1;
  while (Date.now() - started < 20_000) {
    try {
      const buf = await fs.readFile(pdfPath);
      const done = buf.subarray(0, 5).toString() === "%PDF-" && buf.subarray(-16).includes(Buffer.from("%%EOF"));
      if (done && buf.length === lastSize) return buf;
      if (done) lastSize = buf.length;
    } catch {
      lastSize = -1;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("PDF was not created. Chrome is required for download.");
}
