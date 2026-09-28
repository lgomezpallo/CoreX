from pathlib import Path
import re

ROOT = Path('/tmp/router-export')


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


# ---------------------------------------------------------------------------
# 1) Make NVIDIA a first-class provider kind. The DB kind column is text, so
#    this requires no schema migration.
# ---------------------------------------------------------------------------
replace_everywhere(
    "['openai', 'anthropic', 'gemini', 'openai-compatible', 'groq', 'cloudflare']",
    "['openai', 'anthropic', 'gemini', 'openai-compatible', 'groq', 'cloudflare', 'nvidia']",
)
replace_everywhere(
    '"openai" | "anthropic" | "gemini" | "openai-compatible" | "groq" | "cloudflare"',
    '"openai" | "anthropic" | "gemini" | "openai-compatible" | "groq" | "cloudflare" | "nvidia"',
)
replace_everywhere(
    "'openai' | 'anthropic' | 'gemini' | 'openai-compatible' | 'groq' | 'cloudflare'",
    "'openai' | 'anthropic' | 'gemini' | 'openai-compatible' | 'groq' | 'cloudflare' | 'nvidia'",
)
replace_everywhere(
    'enum: [openai, anthropic, gemini, openai-compatible, groq, cloudflare]',
    'enum: [openai, anthropic, gemini, openai-compatible, groq, cloudflare, nvidia]',
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
    if 'nvidia' not in text.lower():
        text = text.replace("  cloudflare: 'cloudflare',", "  cloudflare: 'cloudflare',\n  nvidia: 'nvidia',")
        text = text.replace('  cloudflare: "cloudflare",', '  cloudflare: "cloudflare",\n  nvidia: "nvidia",')
        text = text.replace("  CLOUDFLARE: 'cloudflare',", "  CLOUDFLARE: 'cloudflare',\n  NVIDIA: 'nvidia',")
        text = text.replace('  CLOUDFLARE: "cloudflare",', '  CLOUDFLARE: "cloudflare",\n  NVIDIA: "nvidia",')
    p.write_text(text)

# Exhaustive frontend maps.
for p in (ROOT / 'artifacts/router-ia/src').rglob('*.tsx'):
    text = p.read_text()
    changed = False
    pattern = re.compile(r'(Record<Provider(?:Input)?Kind,\s*([^>]+)>\s*=\s*\{)(.*?)(\n\s*\};)', re.S)
    pos = 0
    out = []
    for m in pattern.finditer(text):
        out.append(text[pos:m.start()])
        head, value_type, body, tail = m.group(1), m.group(2), m.group(3), m.group(4)
        if re.search(r'\bnvidia\s*:', body):
            out.append(m.group(0))
        else:
            if '[]' in value_type:
                value = '[]'
            elif 'string' in value_type:
                value = "'Catálogo automático de NVIDIA NIM'"
            elif 'boolean' in value_type:
                value = 'false'
            elif 'number' in value_type:
                value = '0'
            else:
                groq = re.search(r'\bgroq\s*:\s*([^,\n]+)', body)
                value = groq.group(1).strip() if groq else 'undefined as never'
            body = body.rstrip() + f"\n  nvidia: {value},"
            out.append(head + body + tail)
            changed = True
        pos = m.end()
    if changed:
        out.append(text[pos:])
        p.write_text(''.join(out))

# ---------------------------------------------------------------------------
# 2) Backend provider catalog abstraction.
# ---------------------------------------------------------------------------
p = ROOT / 'artifacts/api-server/src/lib/ai-router.ts'
text = p.read_text()

# ProviderKind after the Cloudflare patch.
text = text.replace(
    '  | "groq"\n  | "cloudflare";',
    '  | "groq"\n  | "cloudflare"\n  | "nvidia";',
    1,
)

if 'NVIDIA_API_BASE_URL' not in text:
    text = text.replace(
        'export const GROQ_API_BASE_URL = "https://api.groq.com/openai/v1";',
        'export const GROQ_API_BASE_URL = "https://api.groq.com/openai/v1";\nexport const NVIDIA_API_BASE_URL = "https://integrate.api.nvidia.com/v1";',
        1,
    )

if 'case "nvidia":' not in text:
    text = text.replace(
        '    case "groq":\n      return GROQ_API_BASE_URL;',
        '    case "groq":\n      return GROQ_API_BASE_URL;\n    case "nvidia":\n      return NVIDIA_API_BASE_URL;',
        1,
    )

catalog_marker = 'export type OpenRouterAudioFormat ='
if 'export type ProviderCatalogModel =' not in text:
    helper = r'''export type ProviderCatalogModel = {
  id: string;
  capabilities: Array<"chat" | "coding" | "reasoning" | "summarization" | "vision" | "document" | "long_context" | "fast">;
  contextLength?: number;
  publisher?: string;
};

const providerCatalogCache = new Map<string, { expiresAt: number; models: ProviderCatalogModel[] }>();
const PROVIDER_CATALOG_TTL_MS = 5 * 60 * 1000;

function inferProviderModelCapabilities(id: string, contextLength?: number): ProviderCatalogModel["capabilities"] {
  const s = id.toLowerCase();
  const result = new Set<ProviderCatalogModel["capabilities"][number]>();
  const nonChat = /whisper|tts|speech|embed|embedding|rerank|guard|moderation|classifier|reward/.test(s);
  if (!nonChat) {
    result.add("chat");
    result.add("summarization");
  }
  if (/code|coder|coding|devstral/.test(s)) result.add("coding");
  if (/reason|thinking|think|deepseek-r1|gpt-oss|qwq|(^|[/_-])r1([/_-]|$)/.test(s)) result.add("reasoning");
  if (/vision|vl|multimodal|llava/.test(s)) result.add("vision");
  if (contextLength && contextLength >= 128000) result.add("long_context");
  if (/8b|instant|mini|flash|small/.test(s)) result.add("fast");
  return [...result];
}

function providerCatalogCacheKey(provider: ProviderConfig): string {
  return `${provider.kind}|${provider.baseUrl ?? ""}`;
}

async function listOpenAICompatibleModels(provider: ProviderConfig): Promise<ProviderCatalogModel[]> {
  const baseUrl = baseUrlFor(provider);
  const payload = await requestJson(
    `${baseUrl}/models`,
    { method: "GET", headers: { authorization: `Bearer ${provider.apiKey}`, accept: "application/json" } },
    provider.apiKey,
  );
  const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
  return rows.map(asRecord).map((item) => {
    const id = typeof item.id === "string" ? item.id.trim() : typeof item.name === "string" ? item.name.trim() : "";
    const contextLength = typeof item.context_window === "number" ? item.context_window : typeof item.context_length === "number" ? item.context_length : undefined;
    return {
      id,
      capabilities: inferProviderModelCapabilities(id, contextLength),
      ...(contextLength ? { contextLength } : {}),
      ...(typeof item.owned_by === "string" ? { publisher: item.owned_by } : {}),
    };
  }).filter((item) => item.id.length > 0);
}

export async function listProviderAccountModels(provider: ProviderConfig, forceRefresh = false): Promise<ProviderCatalogModel[]> {
  const cacheKey = providerCatalogCacheKey(provider);
  const cached = providerCatalogCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.models;

  let models: ProviderCatalogModel[] = [];
  if (provider.kind === "groq") {
    const groq = await listGroqModels(provider.apiKey);
    models = groq.map((m) => ({
      id: m.id,
      capabilities: inferProviderModelCapabilities(m.id, m.contextWindow),
      ...(m.contextWindow ? { contextLength: m.contextWindow } : {}),
      ...(m.ownedBy ? { publisher: m.ownedBy } : {}),
    }));
  } else if (provider.kind === "nvidia" || provider.kind === "openai-compatible") {
    models = await listOpenAICompatibleModels(provider);
  } else if (provider.kind === "cloudflare") {
    const cf = await listCloudflareModels(provider.apiKey, provider.baseUrl ?? "");
    models = cf.map((m) => ({
      id: m.id,
      capabilities: inferProviderModelCapabilities(m.id),
      publisher: "cloudflare",
    }));
  } else {
    // Official providers that do not yet have a normalized catalog adapter keep
    // their configured model as a safe compatibility fallback.
    models = provider.model && provider.model !== "__auto__"
      ? [{ id: provider.model, capabilities: inferProviderModelCapabilities(provider.model) }]
      : [];
  }

  const usable = models.filter((m) => m.capabilities.length > 0);
  providerCatalogCache.set(cacheKey, { expiresAt: Date.now() + PROVIDER_CATALOG_TTL_MS, models: usable });
  return usable;
}

export async function chooseProviderAccountModel(
  provider: ProviderConfig,
  task: "chat" | "coding" | "reasoning" | "summarization" | "vision" | "document" = "chat",
): Promise<string> {
  const models = await listProviderAccountModels(provider);
  const matching = models.filter((m) => m.capabilities.includes(task));
  const pool = matching.length ? matching : models;
  if (!pool.length) throw new ProviderRequestError("The provider account did not return any usable models.", 503);
  const preferred = pool.find((m) => m.capabilities.includes("fast")) ?? pool[0];
  return preferred.id;
}

'''
    text = text.replace(catalog_marker, helper + catalog_marker, 1)

# __auto__ support for direct tests/calls. Cloudflare already has a dedicated picker.
old = '  let model = options.model?.trim() || provider.model;\n  if (provider.kind === "cloudflare" && (!model || model === "__auto__")) {\n    model = await chooseCloudflareChatModel(provider);\n  }'
new = '  let model = options.model?.trim() || provider.model;\n  if (provider.kind === "cloudflare" && (!model || model === "__auto__")) {\n    model = await chooseCloudflareChatModel(provider);\n  } else if ((provider.kind === "groq" || provider.kind === "nvidia" || provider.kind === "openai-compatible") && (!model || model === "__auto__")) {\n    model = await chooseProviderAccountModel(provider, "chat");\n  }'
if old in text:
    text = text.replace(old, new, 1)

p.write_text(text)

# ---------------------------------------------------------------------------
# 3) Expand one provider account into many virtual route candidates.
# ---------------------------------------------------------------------------
p = ROOT / 'artifacts/api-server/src/routes/ai-router.ts'
text = p.read_text()
if 'listProviderAccountModels,' not in text:
    text = text.replace('  listGroqModels,\n', '  listGroqModels,\n  listProviderAccountModels,\n  chooseProviderAccountModel,\n', 1)

if 'async function expandProviderAccountsForRouting' not in text:
    marker = 'function safeProviderError(error: unknown): string {'
    helper = r'''async function expandProviderAccountsForRouting(providers: ProviderRow[]): Promise<RouteProvider[]> {
  const expanded: RouteProvider[] = [];
  for (const provider of providers) {
    const base = toRouteProvider(provider);
    const shouldExpand = provider.model === "__auto__" || provider.kind === "groq" || provider.kind === "nvidia";
    if (!shouldExpand) {
      expanded.push(base);
      continue;
    }
    try {
      const models = await listProviderAccountModels(toProviderConfig(provider));
      if (!models.length) {
        expanded.push(base);
        continue;
      }
      for (const model of models) {
        expanded.push({
          ...base,
          model: model.id,
          capabilities: model.capabilities.length ? model.capabilities : provider.capabilities,
        });
      }
    } catch {
      // Catalog availability must never take down an otherwise usable provider.
      expanded.push(base);
    }
  }
  return expanded;
}

'''
    text = text.replace(marker, helper + marker, 1)

text = text.replace(
    '      providers: providers.map(toRouteProvider),',
    '      providers: await expandProviderAccountsForRouting(providers),',
    1,
)

# Provider test: account-level model + enough output budget for reasoning models.
old = '''    const completion = await runProviderChat(
      toProviderConfig(provider),
      [{ role: "user", content: promptText }],
      { maxTokens: 8 },
    );'''
new = '''    const config = toProviderConfig(provider);
    const testModel = provider.model === "__auto__"
      ? await chooseProviderAccountModel(config, "chat")
      : provider.model;
    const completion = await runProviderChat(
      config,
      [{ role: "user", content: promptText }],
      { maxTokens: 96, model: testModel },
    );'''
if old in text:
    text = text.replace(old, new, 1)

p.write_text(text)

# ---------------------------------------------------------------------------
# 4) Radar: merge connected account catalogs with public OpenRouter signal.
#    Keep the existing response shape to avoid a generated-client migration.
# ---------------------------------------------------------------------------
p = ROOT / 'artifacts/api-server/src/routes/ai-router.ts'
text = p.read_text()
old = '''    const catalog = ListRadarModelsResponse.parse(
      await listZeroCostRadarModels(),
    );
    res.setHeader("Cache-Control", "private, max-age=60");
    res.json(catalog);'''
new = '''    const publicCatalog = await listZeroCostRadarModels();
    const accountRows = await db.select().from(aiProvidersTable)
      .where(and(eq(aiProvidersTable.userId, userId), eq(aiProvidersTable.isActive, true)));
    const accountModels: any[] = [];
    for (const provider of accountRows) {
      try {
        const models = await listProviderAccountModels(toProviderConfig(provider));
        for (const model of models) {
          accountModels.push({
            id: `${provider.name}::${model.id}`,
            name: model.id,
            publisher: provider.name,
            description: `Disponible mediante la cuenta conectada ${provider.name}.`,
            inputModalities: ["text"],
            outputModalities: ["text"],
            capabilities: model.capabilities.filter((c) => ["chat","vision","document","coding","reasoning","long_context"].includes(c)),
            contextLength: model.contextLength ?? null,
            pricingVerifiedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        req.log.warn({ err: error, providerId: provider.id }, "Could not load connected provider catalog for Radar");
      }
    }
    const deduped = new Map<string, any>();
    for (const model of [...accountModels, ...publicCatalog.models]) deduped.set(model.id, model);
    const merged = {
      ...publicCatalog,
      totalModels: deduped.size,
      models: [...deduped.values()],
    };
    const catalog = ListRadarModelsResponse.parse(merged);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.json(catalog);'''
if old not in text:
    raise SystemExit('Radar route marker not found')
text = text.replace(old, new, 1)
p.write_text(text)

# ---------------------------------------------------------------------------
# 5) Frontend: Groq/NVIDIA are account-level connections, not model selectors.
# ---------------------------------------------------------------------------
p = ROOT / 'artifacts/router-ia/src/App.tsx'
text = p.read_text()
if '<option value="nvidia">NVIDIA NIM</option>' not in text:
    text = text.replace('<option value="cloudflare">Cloudflare Workers AI</option>', '<option value="cloudflare">Cloudflare Workers AI</option>\n                <option value="nvidia">NVIDIA NIM</option>', 1)

# Replace the model selector branch with account-catalog info for Groq/NVIDIA.
text = text.replace(
    "{values.kind === 'cloudflare' ? (",
    "{values.kind === 'cloudflare' || values.kind === 'groq' || values.kind === 'nvidia' ? (",
    1,
)
text = text.replace(
    'Catálogo automático de Workers AI. Router IA descubre los modelos de esta cuenta y elige la ruta según la tarea.',
    "{values.kind === 'cloudflare' ? 'Catálogo automático de Workers AI.' : values.kind === 'groq' ? 'Catálogo automático de tu cuenta Groq.' : 'Catálogo automático de NVIDIA NIM.'} Router IA descubre los modelos disponibles y elige según la tarea.",
    1,
)
# The branch after the account card may still contain the old Groq model selector.
text = text.replace(
    ") : values.kind === 'groq' ? (",
    ") : values.kind === 'groq' ? null : (",
    1,
)

# Validation + payload: model sentinel for account providers.
text = text.replace(
    "(values.kind !== 'cloudflare' && !values.model.trim())",
    "(!['cloudflare','groq','nvidia'].includes(values.kind) && !values.model.trim())",
)
text = text.replace(
    "model: values.kind === 'cloudflare' ? '__auto__' : values.model.trim()",
    "model: ['cloudflare','groq','nvidia'].includes(values.kind) ? '__auto__' : values.model.trim()",
)
text = text.replace(
    "model: values.kind === 'cloudflare' ? '__auto__' : values.model.trim()",
    "model: ['cloudflare','groq','nvidia'].includes(values.kind) ? '__auto__' : values.model.trim()",
)

# Groq and NVIDIA do not need a custom URL field.
text = text.replace(
    "{requiresCustomBaseUrl ? '(obligatoria)' : values.kind === 'groq' ? '(administrada por Groq)' : '(no aplica)'}",
    "{requiresCustomBaseUrl ? '(obligatoria)' : values.kind === 'groq' ? '(administrada por Groq)' : values.kind === 'nvidia' ? '(administrada por NVIDIA)' : '(no aplica)'}",
)
text = text.replace(
    "value={values.kind === 'groq' ? 'https://api.groq.com/openai/v1' : values.baseUrl}",
    "value={values.kind === 'groq' ? 'https://api.groq.com/openai/v1' : values.kind === 'nvidia' ? 'https://integrate.api.nvidia.com/v1' : values.baseUrl}",
)

# Display account catalog instead of sentinel.
text = text.replace(
    "{provider.kind === 'cloudflare' ? 'catálogo automático' : provider.model}",
    "{provider.model === '__auto__' ? 'catálogo automático' : provider.model}",
)
p.write_text(text)

# Radar copy: combined connected accounts + public signal.
p = ROOT / 'artifacts/router-ia/src/pages/radar.tsx'
text = p.read_text()
text = text.replace('Señal pública para tu routing.', 'Catálogo vivo para tu routing.')
text = text.replace(
    'Una lectura puntual del catálogo de OpenRouter para encontrar modelos publicados con precio cero y contrastarlos con las rutas que ya tienes conectadas.',
    'Una vista combinada de los modelos disponibles en tus proveedores conectados y la señal pública de modelos sin costo.',
)
text = text.replace('El catálogo se consulta. El tráfico no se toca.', 'Radar sincroniza catálogos. Router decide.')
text = text.replace(
    'Esta superficie es solo lectura: no envía prompts, no ejecuta inferencias y no cambia ninguna configuración de Router IA.',
    'Al conectar un proveedor una sola vez, Radar incorpora automáticamente los modelos disponibles de esa cuenta. No duplica credenciales ni envía prompts.',
)
text = text.replace('modelos revisados', 'modelos descubiertos')
text = text.replace('Catálogo de precio cero', 'Catálogo combinado')
text = text.replace(
    'Solo aparecen entradas con todos los precios publicados exactamente en cero.',
    'Incluye los modelos de tus cuentas conectadas y la señal pública de precio cero disponible en Radar.',
)
p.write_text(text)

# ---------------------------------------------------------------------------
# 6) Self-checks.
# ---------------------------------------------------------------------------
ai = (ROOT / 'artifacts/api-server/src/lib/ai-router.ts').read_text()
routes = (ROOT / 'artifacts/api-server/src/routes/ai-router.ts').read_text()
ui = (ROOT / 'artifacts/router-ia/src/App.tsx').read_text()
radar = (ROOT / 'artifacts/router-ia/src/pages/radar.tsx').read_text()
checks = {
    'NVIDIA provider kind': 'case "nvidia":' in ai,
    'provider catalog function': 'listProviderAccountModels' in ai,
    'virtual route expansion': 'expandProviderAccountsForRouting' in routes,
    'account-level provider test': 'maxTokens: 96' in routes,
    'Radar account merge': 'accountModels' in routes,
    'NVIDIA UI option': 'NVIDIA NIM' in ui,
    'Radar combined copy': 'Catálogo combinado' in radar,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit('Provider account patch incomplete: ' + ', '.join(failed))

print('Provider-account catalogs, automatic routing and Radar merge applied')
