import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { prepareUpload, SHRINK_OVER } from "../bot/lib/shrink.js";
import { pdfPageCount } from "../bot/lib/uploads.js";

test("a file over 8MB is reduced to a smaller JPEG and a small PDF is only split", async () => {
  const raw = crypto.randomBytes(1800 * 1800 * 3);
  const photo = await sharp(raw, { raw: { width: 1800, height: 1800, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  assert.ok(photo.length > SHRINK_OVER);
  const shrunk = await prepareUpload("image/png", photo);
  assert.equal(shrunk.length, 1);
  assert.equal(shrunk[0]?.contentType, "image/jpeg");
  assert.ok(shrunk[0]!.data.length < photo.length);
  assert.ok(shrunk[0]!.data.length <= 1_500_000);
  assert.equal(shrunk[0]!.data.subarray(0, 3).toString("hex"), "ffd8ff");

  const doc = await PDFDocument.create();
  const image = await doc.embedPng(photo);
  const page = doc.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  doc.addPage([200, 200]);
  const pdf = Buffer.from(await doc.save());
  assert.ok(pdf.length > SHRINK_OVER);
  const pages = await prepareUpload("application/pdf", pdf);
  assert.equal(pages.length, 2);
  for (const item of pages) {
    assert.equal(item.contentType, "image/jpeg");
    assert.ok(item.data.length < photo.length);
    assert.equal(item.data.subarray(0, 3).toString("hex"), "ffd8ff");
  }

  const small = Buffer.from(
    `%PDF-1.1
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>endobj
4 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 220 200] >>endobj
trailer<< /Root 1 0 R >>
%%EOF`,
  );
  const kept = await prepareUpload("application/pdf", small);
  assert.equal(kept.length, 2);
  assert.equal(kept[0]?.contentType, "application/pdf");
  assert.equal(pdfPageCount(kept[0]!.data), 1);
});
