import { openDisk, diskDir } from "./disk.js";
import { applyReset, previewReset } from "./month.js";
import { listBins, loadImporter, saveImporter, type Kv } from "./store.js";
import type { ImporterDoc } from "./types.js";

const deletionsKey = (bin: string) => `deletions:${bin}`;

export async function deletedMonths(kv: Kv, bin: string): Promise<string[]> {
  const value = await kv.get(deletionsKey(bin));
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function recordDeletion(kv: Kv, bin: string, month: string): Promise<void> {
  const months = await deletedMonths(kv, bin);
  if (months.includes(month)) return;
  await kv.put(deletionsKey(bin), [...months, month]);
}

function stripDeleted(doc: ImporterDoc, months: string[]): void {
  for (const month of months) {
    const preview = previewReset(doc, month);
    if (!preview.empty && preview.blocked.length === 0) applyReset(doc, month);
  }
}

/** Copy the chat importer onto the website ledger, then re-apply confirmed month deletions. */
export async function mirrorImporter(
  doc: ImporterDoc,
  dir = diskDir(),
): Promise<{ ok: true } | { ok: false; warning: string }> {
  try {
    const kv = openDisk(dir);
    const copy = structuredClone(doc);
    stripDeleted(copy, await deletedMonths(kv, doc.bin));
    await saveImporter(kv, copy);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { ok: false, warning: `Website ledger was not updated: ${message}` };
  }
}

export type SyncResult = {
  applied: { bin: string; month: string }[];
  blocked: { bin: string; month: string; reason: string }[];
};

/** Apply month deletions already confirmed on the website onto the chat books. */
export async function syncDeletions(chat: Kv, dir = diskDir()): Promise<SyncResult> {
  const disk = openDisk(dir);
  const applied: SyncResult["applied"] = [];
  const blocked: SyncResult["blocked"] = [];
  for (const bin of await listBins(chat)) {
    const doc = await loadImporter(chat, bin);
    if (!doc) continue;
    let changed = false;
    for (const month of await deletedMonths(disk, bin)) {
      const preview = previewReset(doc, month);
      if (preview.empty) continue;
      if (preview.blocked.length > 0) {
        blocked.push({
          bin,
          month,
          reason: preview.blocked.map((row) => `${row.challanNo} (${row.issueDate})`).join(", "),
        });
        continue;
      }
      applyReset(doc, month);
      changed = true;
      applied.push({ bin, month });
    }
    if (changed) await saveImporter(chat, doc);
  }
  return { applied, blocked };
}
