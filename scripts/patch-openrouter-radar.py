from pathlib import Path
import re

ROOT = Path('/tmp/router-export')
routes = ROOT / 'artifacts/api-server/src/routes/ai-router.ts'
ai = ROOT / 'artifacts/api-server/src/lib/ai-router.ts'
radar = ROOT / 'artifacts/router-ia/src/pages/radar.tsx'

# ---------------------------------------------------------------------------
# 1) OpenRouter validation belongs in the normalized provider HTTP layer.
#    This guarantees JSON-safe ProviderRequestError handling in Workers.
# ---------------------------------------------------------------------------
text = ai.read_text()
helper_marker = 'export async function listProviderAccountModels(provider: ProviderConfig, forceRefresh = false): Promise<ProviderCatalogModel[]> {'

validation_helper = r'''export async function validateOpenRouterKey(apiKey: string): Promise<void> {
  await requestJson(
    "https://openrouter.ai/api/v1/key",
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
      },
    },
    apiKey,
  );
}

'''

free_catalog_helper = r'''async function listOpenRouterFreeModels(provider: ProviderConfig): Promise<ProviderCatalogModel[]> {
  const baseUrl = baseUrlFor(provider);
  const payload = await requestJson(
    `${baseUrl}/models`,
    { method: "GET", headers: { authorization: `Bearer ${provider.apiKey}`, accept: "application/json" } },
    provider.apiKey,
  );
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return rows.map(asRecord).map((item) => {
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const pricing = asRecord(item.pricing);
    const prompt = typeof pricing.prompt === "string" ? Number(pricing.prompt) : Number.NaN;
    const completion = typeof pricing.completion === "string" ? Number(pricing.completion) : Number.NaN;
    const contextLength = typeof item.context_length === "number" ? item.context_length : undefined;
    return {
      id,
      capabilities: inferProviderModelCapabilities(id, contextLength),
      ...(contextLength ? { contextLength } : {}),
      publisher: typeof item.owned_by === "string" ? item.owned_by : "openrouter",
      free: prompt === 0 && completion === 0,
    };
  })
    .filter((item) => item.id.length > 0 && item.free && item.capabilities.includes("chat"))
    .map(({ free: _free, ...item }) => item);
}

'''

if 'export async function validateOpenRouterKey' not in text:
    if helper_marker not in text:
        raise SystemExit('Provider catalog helper marker not found')
    text = text.replace(helper_marker, validation_helper + helper_marker, 1)

if 'async function listOpenRouterFreeModels' not in text:
    if helper_marker not in text:
        raise SystemExit('Provider catalog helper marker not found for OpenRouter catalog')
    text = text.replace(helper_marker, free_catalog_helper + helper_marker, 1)

old_branch = '''  } else if (provider.kind === "openai-compatible" && (provider.baseUrl ?? "").includes("api.cohere.ai/compatibility/v1")) {'''
new_branch = '''  } else if (provider.kind === "openai-compatible" && (provider.baseUrl ?? "").includes("openrouter.ai/api/v1")) {
    models = await listOpenRouterFreeModels(provider);
  } else if (provider.kind === "openai-compatible" && (provider.baseUrl ?? "").includes("api.cohere.ai/compatibility/v1")) {'''
if old_branch in text and 'models = await listOpenRouterFreeModels(provider);' not in text:
    text = text.replace(old_branch, new_branch, 1)
ai.write_text(text)

# ---------------------------------------------------------------------------
# 2) Route: import normalized validator and remove the direct fetch validator.
# ---------------------------------------------------------------------------
text = routes.read_text()
if 'validateOpenRouterKey,' not in text:
    # Insert beside an existing provider helper imported from ai-router.
    for marker in ['  runProviderChat,\n', '  ProviderRequestError,\n']:
        if marker in text:
            text = text.replace(marker, marker + '  validateOpenRouterKey,\n', 1)
            break
    else:
        raise SystemExit('ai-router import marker not found')

# Remove whichever previous OpenRouter validation block is present.
start = text.find('  if (\n    parsed.data.kind === "openai-compatible" &&\n    baseUrl?.includes("openrouter.ai/api/v1")\n  ) {')
if start >= 0:
    # Block ends immediately before the existing-provider lookup.
    next_marker = '  const [existing] = await db\n'
    end = text.find(next_marker, start)
    if end < 0:
        raise SystemExit('Could not locate end of previous OpenRouter validator')
    text = text[:start] + text[end:]

marker = '''  const [existing] = await db
    .select({ id: aiProvidersTable.id })
    .from(aiProvidersTable)
    .where(eq(aiProvidersTable.userId, userId))
    .limit(1);'''
validation = r'''  if (
    parsed.data.kind === "openai-compatible" &&
    baseUrl?.includes("openrouter.ai/api/v1")
  ) {
    const openRouterApiKey = parsed.data.apiKey?.trim();
    if (!openRouterApiKey) {
      res.status(400).json({ error: "Pegá una API Key de OpenRouter." });
      return;
    }
    try {
      await validateOpenRouterKey(openRouterApiKey);
    } catch (error) {
      res.status(error instanceof ProviderRequestError ? error.statusCode : 502).json({
        error: safeProviderError(error),
      });
      return;
    }
  }

'''
if marker not in text:
    raise SystemExit('Provider create marker not found')
text = text.replace(marker, validation + marker, 1)

# ---------------------------------------------------------------------------
# 3) Never let POST /providers fall through to Express' HTML error handler.
#    Wrap the transaction + response section in a JSON-safe catch.
# ---------------------------------------------------------------------------
start_marker = '  const created = await db.transaction(async (tx) => {'
end_marker = '''  res.setHeader("Cache-Control", "no-store");
  res.status(201).json(CreateProviderResponse.parse(toPublicProvider(created)));'''
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('Provider transaction markers not found')
end += len(end_marker)
original = text[start:end]
if 'Could not save provider' not in original:
    indented = '\n'.join('  ' + line if line else line for line in original.splitlines())
    wrapped = '''  try {
''' + indented + '''
  } catch (error) {
    req.log.error({ err: error }, "Could not save provider");
    res.status(500).json({ error: "El proveedor no pudo guardarse." });
    return;
  }'''
    text = text[:start] + wrapped + text[end:]

routes.write_text(text)

# ---------------------------------------------------------------------------
# 4) Frontend: surface JSON detail, but never dump an upstream HTML document.
# ---------------------------------------------------------------------------
text = radar.read_text()
old_error = "        onError: () => setError('No se pudo conectar. Revisá la Key y los datos de la cuenta.'),"
new_error = r'''        onError: (mutationError: unknown) => {
          const err = mutationError as {
            response?: { data?: { error?: string } };
            data?: { error?: string };
            message?: string;
          };
          const raw = err.response?.data?.error || err.data?.error || err.message || '';
          const detail = /<!doctype|<html/i.test(raw)
            ? 'Router recibió una respuesta web inválida al conectar el proveedor.'
            : raw;
          setError(detail || 'No se pudo conectar. Revisá la Key y los datos de la cuenta.');
        },'''
if old_error in text:
    text = text.replace(old_error, new_error, 1)
elif 'const raw = err.response?.data?.error' not in text:
    # Upgrade the earlier detailed handler.
    text = text.replace(
        "          const detail = err.response?.data?.error || err.data?.error || err.message;\n          setError(detail || 'No se pudo conectar. Revisá la Key y los datos de la cuenta.');",
        "          const raw = err.response?.data?.error || err.data?.error || err.message || '';\n          const detail = /<!doctype|<html/i.test(raw)\n            ? 'Router recibió una respuesta web inválida al conectar el proveedor.'\n            : raw;\n          setError(detail || 'No se pudo conectar. Revisá la Key y los datos de la cuenta.');",
        1,
    )
radar.write_text(text)

# Self-checks.
rt = routes.read_text()
at = ai.read_text()
ui = radar.read_text()
checks = {
    'Normalized OpenRouter validator exported': 'export async function validateOpenRouterKey' in at,
    'Route uses normalized validator': 'await validateOpenRouterKey(openRouterApiKey)' in rt,
    'Direct OpenRouter key fetch removed from route': 'fetch("https://openrouter.ai/api/v1/key"' not in rt,
    'OpenRouter free catalog': 'listOpenRouterFreeModels' in at,
    'Provider create JSON catch': 'Could not save provider' in rt and 'El proveedor no pudo guardarse.' in rt,
    'Radar HTML guard': 'Router recibió una respuesta web inválida' in ui,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit('OpenRouter hardening incomplete: ' + ', '.join(failed))
print('OpenRouter onboarding hardened: normalized validation, free catalog, JSON-only provider save errors')
