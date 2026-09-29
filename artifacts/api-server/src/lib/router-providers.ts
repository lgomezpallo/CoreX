import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const PROVIDER_KINDS = ["openai", "anthropic", "gemini", "openai-compatible", "groq"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export type ProviderRecord = Record<string, unknown> & { id: string };
export type RouterProviderConfig = {
  id: string;
  kind: ProviderKind;
  baseUrl: string | null;
  model: string;
  capabilities: string[];
  priority: number;
  isDefault: boolean;
  apiKey: string;
};

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to protect provider keys.");
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret), Buffer.from("router-ia:key-encryption:v1"), Buffer.from("provider-api-keys"), 32));
}

export function encryptApiKey(apiKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return { api_key_ciphertext: ciphertext.toString("base64"), api_key_iv: iv.toString("base64"), api_key_tag: cipher.getAuthTag().toString("base64"), api_key_preview: `${apiKey.length > 12 ? apiKey.slice(0, 5) : ""}••••••${apiKey.slice(-4)}` };
}

export function decryptApiKey(row: ProviderRecord): string {
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(String(row.api_key_iv), "base64"));
  decipher.setAuthTag(Buffer.from(String(row.api_key_tag), "base64"));
  return Buffer.concat([decipher.update(Buffer.from(String(row.api_key_ciphertext), "base64")), decipher.final()]).toString("utf8");
}

function isPublicIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    const firstHextet = Number.parseInt(normalized.split(":")[0] || "0", 16);
    return firstHextet >= 0x2000 && firstHextet <= 0x3fff &&
      !normalized.startsWith("2001:db8:");
  }
  return false;
}

export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Use a valid HTTPS API address."); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const ip = isIP(host);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (ip !== 0 && !isPublicIp(host))
  ) {
    throw new Error("Use a public HTTPS API address for this provider.");
  }
  return url.toString().replace(/\/+$/, "");
}

export async function validateBaseUrl(value: string): Promise<string> {
  const normalized = normalizeBaseUrl(value);
  const host = new URL(normalized).hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new Error("The provider address must resolve only to public IP addresses.");
  }
  return normalized;
}

function config(): { url: string; key: string } {
  const url = process.env.VITE_SUPABASE_URL?.trim();
  const key = process.env.VITE_SUPABASE_PUBLIC_KEY?.trim();
  if (!url || !key) throw new Error("Supabase is not configured.");
  return { url: url.replace(/\/+$/, ""), key };
}

async function rest(path: string, token: string, init: RequestInit = {}): Promise<unknown> {
  const c = config();
  const response = await fetch(`${c.url}/rest/v1/${path}`, { ...init, headers: { apikey: c.key, authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Supabase returned HTTP ${response.status}.`);
  return response.status === 204 ? null : response.json();
}

function publicRow(row: ProviderRecord) {
  return { id: row.id, name: row.name, kind: row.kind, baseUrl: row.base_url ?? null, model: row.model, apiKeyPreview: row.api_key_preview, isDefault: row.is_default, capabilities: row.capabilities, priority: row.priority, isActive: row.is_active, status: row.status, healthStatus: row.health_status, lastTestAt: row.last_test_at ?? null };
}

const publicProviderFields = "id,name,kind,base_url,model,api_key_preview,is_default,capabilities,priority,is_active,status,health_status,last_test_at";

export async function listProviders(token: string) {
  const rows = await rest(
    `ai_providers?select=${publicProviderFields}&order=is_default.desc,priority.desc`,
    token,
  ) as ProviderRecord[];
  return rows.map(publicRow);
}

export async function createProvider(token: string, userId: string, input: Record<string, any>) {
  if (!PROVIDER_KINDS.includes(input.kind) || typeof input.apiKey !== "string") throw new Error("Invalid provider.");
  const isActive = input.isActive !== false;
  const isDefault = input.isDefault === true;
  if (isDefault && !isActive) throw new Error("An inactive provider cannot be the default.");
  const capabilities = input.capabilities ?? ["chat"];
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    throw new Error("Select at least one provider capability.");
  }
  const encrypted = encryptApiKey(input.apiKey);
  const row = { user_id: userId, name: input.name.trim(), kind: input.kind, base_url: input.kind === "openai-compatible" ? await validateBaseUrl(input.baseUrl ?? "") : null, model: input.model.trim(), capabilities, priority: input.priority ?? 50, is_active: isActive, is_default: isDefault, status: "untested", health_status: "available", ...encrypted };
  if (row.is_default) await rest("ai_providers?is_default=eq.true", token, { method: "PATCH", body: JSON.stringify({ is_default: false, updated_at: new Date().toISOString() }) });
  const rows = await rest(`ai_providers?select=${publicProviderFields}`, token, { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(row) }) as ProviderRecord[];
  return publicRow(rows[0]);
}

export async function updateProvider(token: string, id: string, input: Record<string, any>) {
  const existingRows = await rest(
    `ai_providers?id=eq.${encodeURIComponent(id)}&select=id,kind,is_active,is_default`,
    token,
  ) as ProviderRecord[];
  const existing = existingRows[0];
  if (!existing) throw new Error("Provider not found.");
  const nextActive = input.isActive ?? existing.is_active;
  const nextDefault = input.isDefault ?? existing.is_default;
  const row: Record<string, unknown> = {};
  for (const [from, to] of [["name", "name"], ["model", "model"], ["priority", "priority"], ["isActive", "is_active"], ["isDefault", "is_default"], ["capabilities", "capabilities"]] as const) if (input[from] !== undefined) row[to] = input[from];
  if (nextDefault && !nextActive) row.is_default = false;
  if (input.kind !== undefined && input.kind !== existing.kind) throw new Error("Provider type cannot be changed; add a new provider instead.");
  if (input.baseUrl !== undefined && existing.kind !== "openai-compatible") {
    throw new Error("A custom URL can only be set for OpenAI-compatible providers.");
  }
  if (input.baseUrl !== undefined) {
    if (typeof input.baseUrl !== "string" || !input.baseUrl.trim()) {
      throw new Error("A base URL is required for OpenAI-compatible providers.");
    }
    row.base_url = await validateBaseUrl(input.baseUrl);
  }
  if (input.apiKey) Object.assign(row, encryptApiKey(input.apiKey));
  if (Array.isArray(input.capabilities) && input.capabilities.length === 0) {
    throw new Error("Select at least one provider capability.");
  }
  row.updated_at = new Date().toISOString();
  if (row.is_default === true) await rest(`ai_providers?is_default=eq.true&id=neq.${encodeURIComponent(id)}`, token, { method: "PATCH", body: JSON.stringify({ is_default: false, updated_at: new Date().toISOString() }) });
  const rows = await rest(`ai_providers?id=eq.${encodeURIComponent(id)}&select=${publicProviderFields}`, token, { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify(row) }) as ProviderRecord[];
  if (!rows[0]) throw new Error("Provider not found.");
  return publicRow(rows[0]);
}

export async function deleteProvider(token: string, id: string) {
  await rest(`ai_providers?id=eq.${encodeURIComponent(id)}`, token, { method: "DELETE" });
}

function toProviderConfig(row: ProviderRecord): RouterProviderConfig {
  return {
    id: row.id,
    kind: row.kind as ProviderKind,
    baseUrl: row.base_url == null ? null : String(row.base_url),
    model: String(row.model),
    capabilities: row.capabilities as string[],
    priority: Number(row.priority),
    isDefault: row.is_default === true,
    apiKey: decryptApiKey(row),
  };
}

const privateProviderFields = "id,kind,base_url,model,capabilities,priority,is_default,api_key_ciphertext,api_key_iv,api_key_tag";

export async function getProviderConfig(token: string, id: string): Promise<RouterProviderConfig | null> {
  const rows = await rest(
    `ai_providers?id=eq.${encodeURIComponent(id)}&select=${privateProviderFields}`,
    token,
  ) as ProviderRecord[];
  if (!rows[0]) return null;
  const config = toProviderConfig(rows[0]);
  if (config.kind === "openai-compatible") {
    config.baseUrl = await validateBaseUrl(config.baseUrl ?? "");
  }
  return config;
}

export async function recordProviderTestResult(
  token: string,
  id: string,
  result: { ok: boolean; testedAt: string },
): Promise<void> {
  const updatedAt = new Date().toISOString();
  await rest(`ai_providers?id=eq.${encodeURIComponent(id)}`, token, {
    method: "PATCH",
    body: JSON.stringify({
      status: result.ok ? "connected" : "error",
      health_status: result.ok ? "healthy" : "unavailable",
      consecutive_failures: result.ok ? 0 : 1,
      last_test_at: result.testedAt,
      updated_at: updatedAt,
    }),
  });
}

export async function providerConfigs(token: string) {
  const rows = await rest(
    `ai_providers?select=${privateProviderFields}&is_active=eq.true&order=is_default.desc,priority.desc`,
    token,
  ) as ProviderRecord[];
  return Promise.all(rows.map(async (row) => {
    const config = toProviderConfig(row);
    if (config.kind === "openai-compatible") {
      config.baseUrl = await validateBaseUrl(config.baseUrl ?? "");
    }
    return config;
  }));
}