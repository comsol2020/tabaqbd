import fs from "node:fs/promises";
import path from "node:path";
import type { Kv } from "./store.js";

type JsonValue = Parameters<Kv["put"]>[1];

const cache = new Map<string, Kv>();

export function diskDir(): string {
  return process.env.VAT_DATA_DIR
    ? path.resolve(process.env.VAT_DATA_DIR)
    : path.resolve(process.cwd(), "data");
}

export function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

export function openDisk(dir = diskDir()): Kv {
  const resolved = path.resolve(dir);
  const existing = cache.get(resolved);
  if (existing) return existing;
  const created = createDiskKv(resolved);
  cache.set(resolved, created);
  return created;
}

function createDiskKv(dir: string): Kv {
  const file = path.join(dir, "kv.json");
  let chain: Promise<unknown> = Promise.resolve();
  const withLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  const read = async (): Promise<Record<string, JsonValue>> => {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, JsonValue>;
      }
    } catch {
      // missing or unreadable file starts empty
    }
    return {};
  };
  const write = async (all: Record<string, JsonValue>): Promise<void> => {
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(all));
    await fs.rename(tmp, file);
  };
  return {
    get(key) {
      return withLock(async () => (await read())[key]);
    },
    put(key, value) {
      return withLock(async () => {
        const all = await read();
        all[key] = value;
        await write(all);
      });
    },
    delete(key) {
      return withLock(async () => {
        const all = await read();
        delete all[key];
        await write(all);
      });
    },
  };
}
