import crypto from "node:crypto";
import { asJson } from "./disk.js";
import type { Kv } from "./store.js";
import { normalizeBin } from "./vat.js";

const pinKey = (bin: string) => `pin:${bin}`;

export function assertPin(pin: string): void {
  if (!/^\d{11}$/.test(pin)) {
    throw new Error("পিন ১১ সংখ্যার হতে হবে।");
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

const OPERATOR_KEY = "operator:pin";

export function hashSecret(secret: string): { salt: string; hash: string } {
  if (secret.length < 4 || secret.length > 80) throw new Error("পাসওয়ার্ড ৪ থেকে ৮০ অক্ষরের হতে হবে।");
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(secret, salt, 32).toString("hex");
  return { salt, hash };
}

function sameSecret(a: string, b: string): boolean {
  const left = crypto.createHash("sha256").update(a).digest();
  const right = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(left, right);
}

export async function operatorPinConfigured(kv: Kv, envPin: string): Promise<boolean> {
  if (envPin) return true;
  const stored = await kv.get(OPERATOR_KEY);
  return !!stored && typeof stored === "object" && !Array.isArray(stored);
}

export async function operatorPinMatches(kv: Kv, pin: string, envPin: string): Promise<boolean> {
  const stored = await kv.get(OPERATOR_KEY);
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    return verifyPin(pin, stored as { salt?: unknown; hash?: unknown });
  }
  if (!envPin) return false;
  return sameSecret(pin, envPin);
}

export async function setOperatorPin(kv: Kv, next: string): Promise<void> {
  await kv.put(OPERATOR_KEY, asJson(hashSecret(next)));
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
