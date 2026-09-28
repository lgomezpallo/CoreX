from pathlib import Path
import re

ROOT = Path('/tmp/router-export')


def replace_all_text_files(old: str, new: str) -> int:
    count = 0
    for base in [ROOT / 'lib', ROOT / 'artifacts']:
        if not base.exists():
            continue
        for p in base.rglob('*'):
            if p.suffix not in {'.ts', '.tsx', '.yaml', '.yml'}:
                continue
            text = p.read_text(errors='replace')
            if old in text:
                n = text.count(old)
                p.write_text(text.replace(old, new))
                count += n
    return count

# Generated/API enums: make Cloudflare a first-class provider kind.
replace_all_text_files(
    "['openai', 'anthropic', 'gemini', 'openai-compatible', 'groq']",
    "['openai', 'anthropic', 'gemini', 'openai-compatible', 'groq', 'cloudflare']",
)
replace_all_text_files(
    '"openai" | "anthropic" | "gemini" | "openai-compatible" | "groq"',
    '"openai" | "anthropic" | "gemini" | "openai-compatible" | "groq" | "cloudflare"',
)
replace_all_text_files(
    "'openai' | 'anthropic' | 'gemini' | 'openai-compatible' | 'groq'",
    "'openai' | 'anthropic' | 'gemini' | 'openai-compatible' | 'groq' | 'cloudflare'",
)
replace_all_text_files(
    'enum: [openai, anthropic, gemini, openai-compatible, groq]',
    'enum: [openai, anthropic, gemini, openai-compatible, groq, cloudflare]',
)

# Orval also emits object-style enum constants. Patch those explicitly because the
# frontend imports ProviderKind / ProviderInputKind from the generated client.
for rel in [
    'lib/api-client-react/src/generated/api.schemas.ts',
    'lib/api-zod/src/generated/types/providerKind.ts',
    'lib/api-zod/src/generated/types/providerInputKind.ts',
]:
    p = ROOT / rel
    if not p.exists():
        continue
    text = p.read_text()
    if 'cloudflare' not in text:
        text = text.replace("  groq: 'groq',", "  groq: 'groq',\n  cloudflare: 'cloudflare',")
        text = text.replace('  groq: "groq",', '  groq: "groq",\n  cloudflare: "cloudflare",')
        text = text.replace("  GROQ: 'groq',", "  GROQ: 'groq',\n  CLOUDFLARE: 'cloudflare',")
        text = text.replace('  GROQ: "groq",', '  GROQ: "groq",\n  CLOUDFLARE: "cloudflare",')
    p.write_text(text)

# Backend adapter: account credential -> dynamic Workers AI catalog -> automatic text model.
p = ROOT / 'artifacts/api-server/src/lib/ai-router.ts'
text = p.read_text()
if '| "cloudflare";' not in text:
    text = text.replace('  | "openai-compatible"\n  | "groq";', '  | "openai-compatible"\n  | "groq"\n  | "cloudflare";', 1)

cloudflare_case = '''    case "cloudflare":\n      if (!provider.baseUrl) {\n        throw new ProviderRequestError("Cloudflare Account ID is required.", 400);\n      }\n      return normalizeCustomBaseUrl(provider.baseUrl);\n'''
if 'case "cloudflare":' not in text:
    text = text.replace('    case "openai-compatible":\n', cloudflare_case + '    case "openai-compatible":\n', 1)

helper_marker = 'export type OpenRouterAudioFormat ='
if 'export async function listCloudflareModels' not in text:
    helper = r'''
export type CloudflareModel = {
  id: string;
  task?: string;
};

function cloudflareAccountIdFromBaseUrl(baseUrl: string): string {
  const match = baseUrl.match(/\/accounts\/([^/]+)\/ai\/v1$/);
  if (!match?.[1]) {
    throw new ProviderRequestError("Cloudflare account URL is invalid.", 400);
  }
  return decodeURIComponent(match[1]);
}

export async function listCloudflareModels(
  apiKey: string,
  baseUrl: string,
): Promise<CloudflareModel[]> {
  const accountId = cloudflareAccountIdFromBaseUrl(baseUrl);
  const payload = await requestJson(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/models/search?per_page=1000`,
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
      },
    },
    apiKey,
  );
  const raw = Array.isArray(payload.result) ? payload.result : [];
  return raw
    .map((item) => asRecord(item))
    .map((item) => {
      const taskRecord = asRecord(item.task);
      const task =
        typeof item.task === "string"
          ? item.task
          : typeof taskRecord.name === "string"
            ? taskRecord.name
            : undefined;
      const id =
        typeof item.name === "string"
          ? item.name
          : typeof item.id === "string"
            ? item.id
            : "";
      return { id: id.trim(), ...(task ? { task } : {}) };
    })
    .filter((item) => item.id.startsWith("@cf/"));
}

async function chooseCloudflareChatModel(provider: ProviderConfig): Promise<string> {
  if (!provider.baseUrl) {
    throw new ProviderRequestError("Cloudflare Account ID is required.", 400);
  }
  const models = await listCloudflareModels(provider.apiKey, provider.baseUrl);
  const textModels = models.filter((m) => {
    const task = (m.task ?? "").toLowerCase();
    return !task || task.includes("text") || task.includes("chat") || task.includes("generation");
  });
  const preferred = [
    "@cf/meta/llama-3.1-8b-instruct",
    "@cf/openai/gpt-oss-20b",
  ];
  for (const id of preferred) {
    if (textModels.some((m) => m.id === id)) return id;
  }
  const heuristic = textModels.find((m) => /instruct|chat|gpt|qwen|llama/i.test(m.id));
  const picked = heuristic ?? textModels[0] ?? models[0];
  if (!picked) {
    throw new ProviderRequestError("Cloudflare Workers AI did not return any available models.", 503);
  }
  return picked.id;
}

'''
    text = text.replace(helper_marker, helper + helper_marker, 1)

old_sig = '''  const model = options.model?.trim() || provider.model;\n  const temperature = options.temperature ?? 0.4;'''
new_sig = '''  let model = options.model?.trim() || provider.model;\n  if (provider.kind === "cloudflare" && (!model || model === "__auto__")) {\n    model = await chooseCloudflareChatModel(provider);\n  }\n  const temperature = options.temperature ?? 0.4;'''
if old_sig in text:
    text = text.replace(old_sig, new_sig, 1)

p.write_text(text)

# Frontend: user adds the Cloudflare account once, not an individual model.
p = ROOT / 'artifacts/router-ia/src/App.tsx'
text = p.read_text()
text = text.replace(
    "type ProviderFormValues = { name: string; kind: ProviderInputKind; apiKey: string; model: string; baseUrl: string; isDefault: boolean };",
    "type ProviderFormValues = { name: string; kind: ProviderInputKind; apiKey: string; model: string; baseUrl: string; accountId: string; isDefault: boolean };",
    1,
)
text = text.replace(
    "const emptyProvider: ProviderFormValues = { name: '', kind: 'openai', apiKey: '', model: '', baseUrl: '', isDefault: false };",
    "const emptyProvider: ProviderFormValues = { name: '', kind: 'openai', apiKey: '', model: '', baseUrl: '', accountId: '', isDefault: false };",
    1,
)
old_init = "provider ? { name: provider.name, kind: provider.kind, apiKey: '', model: provider.model, baseUrl: provider.baseUrl || '', isDefault: provider.isDefault } : emptyProvider"
new_init = "provider ? { name: provider.name, kind: provider.kind, apiKey: '', model: provider.model, baseUrl: provider.baseUrl || '', accountId: provider.kind === 'cloudflare' ? ((provider.baseUrl || '').match(/\\/accounts\\/([^/]+)\\/ai\\/v1$/)?.[1] || '') : '', isDefault: provider.isDefault } : emptyProvider"
text = text.replace(old_init, new_init, 1)
text = text.replace(
    '<option value="groq">Groq</option>',
    '<option value="groq">Groq</option>\n                <option value="cloudflare">Cloudflare Workers AI</option>',
    1,
)

# Hide manual model selection for Cloudflare and show account-level discovery.
model_block_start = "            {values.kind === 'groq' ? ("
if model_block_start in text and "Catálogo automático de Workers AI" not in text:
    text = text.replace(
        model_block_start,
        "            {values.kind === 'cloudflare' ? (\n              <div className=\"rounded-lg border border-border bg-card p-3.5 sm:col-span-2\">\n                <div className=\"field-label\">Modelos</div>\n                <p className=\"mt-1 text-xs leading-5 text-muted-foreground\">Catálogo automático de Workers AI. Router IA descubre los modelos de esta cuenta y elige la ruta según la tarea.</p>\n              </div>\n            ) : values.kind === 'groq' ? (",
        1,
    )

# Add Account ID before API key for Cloudflare.
api_key_marker = "            {values.kind === 'groq' ? (\n"
if "input-cloudflare-account-id" not in text:
    cloudflare_account = '''            {values.kind === 'cloudflare' && (\n              <label className="block sm:col-span-2">\n                <span className="field-label">Cloudflare Account ID</span>\n                <input\n                  data-testid="input-cloudflare-account-id"\n                  value={values.accountId}\n                  onChange={(event) => set('accountId', event.target.value)}\n                  placeholder="Account ID"\n                  className="field-input font-mono"\n                  required\n                />\n              </label>\n            )}\n'''
    pos = text.find(api_key_marker, text.find("Catálogo automático de Workers AI"))
    if pos >= 0:
        text = text[:pos] + cloudflare_account + text[pos:]

# Validation no longer requires a model for Cloudflare; it requires Account ID.
old_validation = "if (!values.name.trim() || !values.model.trim() || (!isEdit && values.kind !== 'groq' && !values.apiKey.trim()))"
new_validation = "if (!values.name.trim() || (values.kind !== 'cloudflare' && !values.model.trim()) || (values.kind === 'cloudflare' && !values.accountId.trim()) || (!isEdit && values.kind !== 'groq' && !values.apiKey.trim()))"
text = text.replace(old_validation, new_validation, 1)

# Build account-level provider payload.
old_data = "const data: ProviderInput = { name: values.name.trim(), kind: values.kind, ...(values.kind === 'groq' ? {} : { apiKey: values.apiKey.trim() }), model: values.model.trim(), baseUrl: values.baseUrl.trim() || undefined, isDefault: values.isDefault };"
new_data = "const cloudflareBaseUrl = values.kind === 'cloudflare' ? `https://api.cloudflare.com/client/v4/accounts/${values.accountId.trim()}/ai/v1` : undefined; const data: ProviderInput = { name: values.name.trim(), kind: values.kind, ...(values.kind === 'groq' ? {} : { apiKey: values.apiKey.trim() }), model: values.kind === 'cloudflare' ? '__auto__' : values.model.trim(), baseUrl: cloudflareBaseUrl || values.baseUrl.trim() || undefined, isDefault: values.isDefault, ...(values.kind === 'cloudflare' ? { capabilities: ['chat','coding','reasoning','summarization','vision','document','long_context','fast'] } : {}) };"
text = text.replace(old_data, new_data, 1)

old_update = "const data: ProviderUpdate = { name: values.name.trim(), model: values.model.trim(), baseUrl: values.baseUrl.trim() || null, isDefault: values.isDefault };"
new_update = "const cloudflareBaseUrl = values.kind === 'cloudflare' ? `https://api.cloudflare.com/client/v4/accounts/${values.accountId.trim()}/ai/v1` : null; const data: ProviderUpdate = { name: values.name.trim(), model: values.kind === 'cloudflare' ? '__auto__' : values.model.trim(), baseUrl: cloudflareBaseUrl || values.baseUrl.trim() || null, isDefault: values.isDefault };"
text = text.replace(old_update, new_update, 1)

# Do not expose the internal sentinel to the user.
text = text.replace("{provider.model} · {provider.apiKeyPreview}", "{provider.kind === 'cloudflare' ? 'catálogo automático' : provider.model} · {provider.apiKeyPreview}")

p.write_text(text)

print('Cloudflare account provider adapter applied')
