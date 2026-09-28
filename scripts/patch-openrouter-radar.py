from pathlib import Path

ROOT = Path('/tmp/router-export')
routes = ROOT / 'artifacts/api-server/src/routes/ai-router.ts'
ai = ROOT / 'artifacts/api-server/src/lib/ai-router.ts'
radar = ROOT / 'artifacts/router-ia/src/pages/radar.tsx'

# 1) Validate OpenRouter keys before saving the provider account.
text = routes.read_text()
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
      const response = await fetch("https://openrouter.ai/api/v1/key", {
        method: "GET",
        headers: {
          authorization: `Bearer ${openRouterApiKey}`,
          accept: "application/json",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const body = await response.text();
        let message = `OpenRouter rechazó la Key (HTTP ${response.status}).`;
        try {
          const payload = JSON.parse(body) as { error?: { message?: string }; message?: string };
          message = payload.error?.message || payload.message || message;
        } catch {}
        res.status(400).json({ error: message });
        return;
      }
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error
          ? `No pude validar la Key con OpenRouter: ${error.message}`
          : "No pude validar la Key con OpenRouter.",
      });
      return;
    }
  }

'''
if 'OpenRouter rechazó la Key' not in text:
    if marker not in text:
        raise SystemExit('Provider create marker not found')
    text = text.replace(marker, validation + marker, 1)
routes.write_text(text)

# 2) OpenRouter account catalog: keep only zero-cost text/chat models.
text = ai.read_text()
helper_marker = 'export async function listProviderAccountModels(provider: ProviderConfig, forceRefresh = false): Promise<ProviderCatalogModel[]> {'
helper = r'''async function listOpenRouterFreeModels(provider: ProviderConfig): Promise<ProviderCatalogModel[]> {
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
if 'async function listOpenRouterFreeModels' not in text:
    if helper_marker not in text:
        raise SystemExit('Provider catalog helper marker not found')
    text = text.replace(helper_marker, helper + helper_marker, 1)

old_branch = '''  } else if (provider.kind === "openai-compatible" && (provider.baseUrl ?? "").includes("api.cohere.ai/compatibility/v1")) {'''
new_branch = '''  } else if (provider.kind === "openai-compatible" && (provider.baseUrl ?? "").includes("openrouter.ai/api/v1")) {
    models = await listOpenRouterFreeModels(provider);
  } else if (provider.kind === "openai-compatible" && (provider.baseUrl ?? "").includes("api.cohere.ai/compatibility/v1")) {'''
if old_branch in text and 'models = await listOpenRouterFreeModels(provider);' not in text:
    text = text.replace(old_branch, new_branch, 1)
ai.write_text(text)

# 3) Give the user the actual server/provider error instead of a generic one.
text = radar.read_text()
old_error = "        onError: () => setError('No se pudo conectar. Revisá la Key y los datos de la cuenta.'),"
new_error = r'''        onError: (mutationError: unknown) => {
          const err = mutationError as {
            response?: { data?: { error?: string } };
            data?: { error?: string };
            message?: string;
          };
          const detail = err.response?.data?.error || err.data?.error || err.message;
          setError(detail || 'No se pudo conectar. Revisá la Key y los datos de la cuenta.');
        },'''
if old_error in text:
    text = text.replace(old_error, new_error, 1)
radar.write_text(text)

# Self-checks.
checks = {
    'OpenRouter key validation': 'OpenRouter rechazó la Key' in routes.read_text(),
    'OpenRouter free catalog': 'listOpenRouterFreeModels' in ai.read_text(),
    'Radar detailed error': 'err.response?.data?.error' in radar.read_text(),
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit('OpenRouter patch incomplete: ' + ', '.join(failed))
print('OpenRouter Radar connection patched: key validation + free-only catalog + visible errors')
