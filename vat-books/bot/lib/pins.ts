import crypto from "node:crypto";
import { asJson } from "./disk.js";
import type { Kv } from "./store.js";
import { normalizeBin } from "./vat.js";

const pinKey = (bin: string) => `pin:${bin}`;

export function assertPin(pin: string): void {
  if (!/^\d{4,8}$/.test(pin)) {
    throw new Error("PIN must be 4 to 8 digits.");
  }
}

export function hashPin(pin: string): { salt: string; hash: string } {
  assertPin(pin);
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pin, salt, 32).toString("hex");
  return { salt, hash };
}

export function verifyPin(pin: string, stored: { salt?: unknown; hash?: unknown }): boolean {
  if (typeof stored.salt !== "string" || typeof stored.hash !== "string") return false;
  const actual = crypto.scryptSync(pin, stored.salt, 32);
  const expected = Buffer.from(stored.hash, "hex");
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export async function setImporterPin(kv: Kv, binInput: string, pin: string): Promise<string> {
  const bin = normalizeBin(binInput);
  await kv.put(pinKey(bin), asJson(hashPin(pin)));
  return bin;
}

export async function importerPinMatches(kv: Kv, binInput: string, pin: string): Promise<string | undefined> {
  let bin: string;
  try {
    bin = normalizeBin(binInput);
  } catch {
    return undefined;
  }
  const stored = await kv.get(pinKey(bin));
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return undefined;
  return verifyPin(pin, stored as { salt?: unknown; hash?: unknown }) ? bin : undefined;
}
