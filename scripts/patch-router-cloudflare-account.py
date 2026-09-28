from pathlib import Path
import re

ROOT = Path('/tmp/router-export')


def patch_file(path: Path, fn):
    text = path.read_text()
    new = fn(text)
    path.write_text(new)


def replace_everywhere(old: str, new: str):
    for base in [ROOT / 'lib', ROOT / 'artifacts']:
        if not base.exists():
            continue
        for p in base.rglob('*'):
            if p.suffix not in {'.ts', '.tsx', '.yml', '.yaml'}:
                continue
            text = p.read_text(errors='replace')
            if old in text:
                p.write_text(text.replace(old, new))

# 1) Generated/API provider enums.
replace_everywhere(
    "['openai', 'anthropic', 'gemini', 'openai-compatible', 'groq']",
    "['openai', 'anthropic', 'gemini', 'openai-compatible', 'groq', 'cloudflare']",
)
replace_everywhere(
    '"openai" | "anthropic" | "gemini" | "openai-compatible" | "groq"',
    '"openai" | "anthropic" | "gemini" | "openai-compatible" | "groq" | "cloudflare"',
)
replace_everywhere(
    "'openai' | 'anthropic' | 'gemini' | 'openai-compatible' | 'groq'",
    "'openai' | 'anthropic' | 'gemini' | 'openai-compatible' | 'groq' | 'cloudflare'",
)
replace_everywhere(
    'enum: [openai, anthropic, gemini, openai-compatible, groq]',
    'enum: [openai, anthropic, gemini, openai-compatible, groq, cloudflare]',
)

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

# 2) Exhaustive ProviderInputKind/ProviderKind maps in frontend.
for p in (ROOT / 'artifacts/router-ia/src').rglob('*.tsx'):
    text = p.read_text()
    changed = False
    pattern = re.compile(r'(Record<Provider(?:Input)?Kind,\s*([^>]+)>\s*=\s*\{)(.*?)(\n\s*\};)', re.S)
    pos = 0
    out = []
    for m in pattern.finditer(text):
        out.append(text[pos:m.start()])
        head, value_type, body, tail = m.group(1), m.group(2), m.group(3), m.group(4)
        if re.search(r'\bcloudflare\s*:', body):
            out.append(m.group(0))
        else:
            if '[]' in value_type:
                value = '[]'
            elif 'string' in value_type:
                value = "'Catálogo automático de Workers AI'"
            elif 'boolean' in value_type:
                value = 'false'
            elif 'number' in value_type:
                value = '0'
            else:
                groq = re.search(r'\bgroq\s*:\s*([^,\n]+)', body)
                value = groq.group(1).strip() if groq else 'undefined as never'
            body = body.rstrip() + f"\n  cloudflare: {value},"
            out.append(head + body + tail)
            changed = True
        pos = m.end()
    if changed:
        out.append(text[pos:])
        p.write_text(''.join(out))

# 3) Backend: account credential -> model discovery -> automatic text model.
p = ROOT / 'artifacts/api-server/src/lib/ai-router.ts'
text = p.read_text()
# Cloudflare Workers only supports redirect="follow" or "manual".
text = text.replace('redirect: "error"', 'redirect: "follow"')
text = text.replace(
    '  | "openai-compatible"\n  | "groq";',
    '  | "openai-compatible"\n  | "groq"\n  | "cloudflare";',
    1,
)
if 'case "cloudflare":' not in text:
    text = text.replace(
        '    case "openai-compatible":\n',
        '    case "cloudflare":\n      if (!provider.baseUrl) throw new ProviderRequestError("Cloudflare Account ID is required.", 400);\n      return normalizeCustomBaseUrl(provider.baseUrl);\n    case "openai-compatible":\n',
        1,
    )

if 'export async function listCloudflareModels' not in text:
    marker = 'export type OpenRouterAudioFormat ='
    helper = r'''export type CloudflareModel = { id: string; task?: string };

function cloudflareAccountIdFromBaseUrl(baseUrl: string): string {
  const match = baseUrl.match(/\/accounts\/([^/]+)\/ai\/v1$/);
  if (!match?.[1]) throw new ProviderRequestError("Cloudflare account URL is invalid.", 400);
  return decodeURIComponent(match[1]);
}

export async function listCloudflareModels(apiKey: string, baseUrl: string): Promise<CloudflareModel[]> {
  const accountId = cloudflareAccountIdFromBaseUrl(baseUrl);
  const payload = await requestJson(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/models/search?per_page=1000`,
    { method: "GET", headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" } },
    apiKey,
  );
  const raw = Array.isArray(payload.result) ? payload.result : [];
  return raw.map(asRecord).map((item) => {
    const taskRecord = asRecord(item.task);
    const task = typeof item.task === "string" ? item.task : typeof taskRecord.name === "string" ? taskRecord.name : undefined;
    const id = typeof item.name === "string" ? item.name : typeof item.id === "string" ? item.id : "";
    return { id: id.trim(), ...(task ? { task } : {}) };
  }).filter((item) => item.id.startsWith("@cf/"));
}

async function chooseCloudflareChatModel(provider: ProviderConfig): Promise<string> {
  if (!provider.baseUrl) throw new ProviderRequestError("Cloudflare Account ID is required.", 400);
  const models = await listCloudflareModels(provider.apiKey, provider.baseUrl);
  const textModels = models.filter((m) => {
    const task = (m.task ?? "").toLowerCase();
    return !task || task.includes("text") || task.includes("chat") || task.includes("generation");
  });
  for (const id of ["@cf/meta/llama-3.1-8b-instruct", "@cf/openai/gpt-oss-20b"]) {
    if (textModels.some((m) => m.id === id)) return id;
  }
  const picked = textModels.find((m) => /instruct|chat|gpt|qwen|llama/i.test(m.id)) ?? textModels[0] ?? models[0];
  if (!picked) throw new ProviderRequestError("Cloudflare Workers AI did not return any available models.", 503);
  return picked.id;
}

'''
    text = text.replace(marker, helper + marker, 1)

text = text.replace(
    '  const model = options.model?.trim() || provider.model;\n  const temperature = options.temperature ?? 0.4;',
    '  let model = options.model?.trim() || provider.model;\n  if (provider.kind === "cloudflare" && (!model || model === "__auto__")) {\n    model = await chooseCloudflareChatModel(provider);\n  }\n  const temperature = options.temperature ?? 0.4;',
    1,
)
p.write_text(text)

# 4) Frontend account-level form.
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
text = text.replace(
    "provider ? { name: provider.name, kind: provider.kind, apiKey: '', model: provider.model, baseUrl: provider.baseUrl || '', isDefault: provider.isDefault } : emptyProvider",
    "provider ? { name: provider.name, kind: provider.kind, apiKey: '', model: provider.model, baseUrl: provider.baseUrl || '', accountId: provider.kind === 'cloudflare' ? ((provider.baseUrl || '').match(/\\/accounts\\/([^/]+)\\/ai\\/v1$/)?.[1] || '') : '', isDefault: provider.isDefault } : emptyProvider",
    1,
)
if '<option value="cloudflare">Cloudflare Workers AI</option>' not in text:
    text = text.replace('<option value="groq">Groq</option>', '<option value="groq">Groq</option>\n                <option value="cloudflare">Cloudflare Workers AI</option>', 1)

if "Catálogo automático de Workers AI. Router IA descubre" not in text:
    text = text.replace(
        "            {values.kind === 'groq' ? (",
        "            {values.kind === 'cloudflare' ? (\n              <div className=\"rounded-lg border border-border bg-card p-3.5 sm:col-span-2\">\n                <div className=\"field-label\">Modelos</div>\n                <p className=\"mt-1 text-xs leading-5 text-muted-foreground\">Catálogo automático de Workers AI. Router IA descubre los modelos de esta cuenta y elige la ruta según la tarea.</p>\n              </div>\n            ) : values.kind === 'groq' ? (",
        1,
    )

if 'input-cloudflare-account-id' not in text:
    marker = "            {values.kind === 'groq' ? (\n"
    pos = text.find(marker, text.find('Catálogo automático de Workers AI. Router IA descubre'))
    account = '''            {values.kind === 'cloudflare' && (\n              <label className="block sm:col-span-2">\n                <span className="field-label">Cloudflare Account ID</span>\n                <input data-testid="input-cloudflare-account-id" value={values.accountId} onChange={(event) => set('accountId', event.target.value)} placeholder="Account ID" className="field-input font-mono" required />\n              </label>\n            )}\n'''
    if pos >= 0:
        text = text[:pos] + account + text[pos:]

text = text.replace(
    "if (!values.name.trim() || !values.model.trim() || (!isEdit && values.kind !== 'groq' && !values.apiKey.trim()))",
    "if (!values.name.trim() || (values.kind !== 'cloudflare' && !values.model.trim()) || (values.kind === 'cloudflare' && !values.accountId.trim()) || (!isEdit && values.kind !== 'groq' && !values.apiKey.trim()))",
    1,
)
text = text.replace(
    "const data: ProviderInput = { name: values.name.trim(), kind: values.kind, ...(values.kind === 'groq' ? {} : { apiKey: values.apiKey.trim() }), model: values.model.trim(), baseUrl: values.baseUrl.trim() || undefined, isDefault: values.isDefault };",
    "const cloudflareBaseUrl = values.kind === 'cloudflare' ? `https://api.cloudflare.com/client/v4/accounts/${values.accountId.trim()}/ai/v1` : undefined; const data: ProviderInput = { name: values.name.trim(), kind: values.kind, ...(values.kind === 'groq' ? {} : { apiKey: values.apiKey.trim() }), model: values.kind === 'cloudflare' ? '__auto__' : values.model.trim(), baseUrl: cloudflareBaseUrl || values.baseUrl.trim() || undefined, isDefault: values.isDefault, ...(values.kind === 'cloudflare' ? { capabilities: ['chat','coding','reasoning','summarization','vision','document','long_context','fast'] } : {}) };",
    1,
)
text = text.replace(
    "const data: ProviderUpdate = { name: values.name.trim(), model: values.model.trim(), baseUrl: values.baseUrl.trim() || null, isDefault: values.isDefault };",
    "const cloudflareBaseUrl = values.kind === 'cloudflare' ? `https://api.cloudflare.com/client/v4/accounts/${values.accountId.trim()}/ai/v1` : null; const data: ProviderUpdate = { name: values.name.trim(), model: values.kind === 'cloudflare' ? '__auto__' : values.model.trim(), baseUrl: cloudflareBaseUrl || values.baseUrl.trim() || null, isDefault: values.isDefault };",
    1,
)
text = text.replace("{provider.model} · {provider.apiKeyPreview}", "{provider.kind === 'cloudflare' ? 'catálogo automático' : provider.model} · {provider.apiKeyPreview}")
p.write_text(text)

# Self-check: any exhaustive provider map still missing Cloudflare is a patch failure.
missing = []
for p in (ROOT / 'artifacts/router-ia/src').rglob('*.tsx'):
    t = p.read_text()
    for m in re.finditer(r'Record<Provider(?:Input)?Kind,\s*[^>]+>\s*=\s*\{(.*?)\n\s*\};', t, re.S):
        if not re.search(r'\bcloudflare\s*:', m.group(1)):
            missing.append(str(p))
if missing:
    raise SystemExit('Cloudflare map patch incomplete: ' + ', '.join(sorted(set(missing))))

print('Cloudflare account provider adapter applied and verified')