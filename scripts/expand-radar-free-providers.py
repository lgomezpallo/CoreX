from pathlib import Path

ROOT = Path('/tmp/router-export')
routes = ROOT / 'artifacts/api-server/src/routes/ai-router.ts'
ai = ROOT / 'artifacts/api-server/src/lib/ai-router.ts'
radar = ROOT / 'artifacts/router-ia/src/pages/radar.tsx'

# ---------------------------------------------------------------------------
# 1) Expand discovered-provider registry from 4 to 8 useful providers.
# ---------------------------------------------------------------------------
text = routes.read_text()
text = text.replace(
    'id: "openrouter" | "groq" | "nvidia" | "cloudflare";',
    'id: "openrouter" | "groq" | "nvidia" | "cloudflare" | "gemini" | "mistral" | "cohere" | "huggingface";',
    1,
)

connected_marker = '''      if (provider.kind === "openai-compatible" && (provider.baseUrl ?? "").includes("openrouter.ai")) connectedIds.add("openrouter");'''
connected_replacement = connected_marker + '''
      if (provider.kind === "openai-compatible" && (provider.baseUrl ?? "").includes("generativelanguage.googleapis.com")) connectedIds.add("gemini");
      if (provider.kind === "openai-compatible" && (provider.baseUrl ?? "").includes("api.mistral.ai")) connectedIds.add("mistral");
      if (provider.kind === "openai-compatible" && (provider.baseUrl ?? "").includes("api.cohere.ai")) connectedIds.add("cohere");
      if (provider.kind === "openai-compatible" && (provider.baseUrl ?? "").includes("router.huggingface.co")) connectedIds.add("huggingface");'''
if connected_marker in text and 'connectedIds.add("gemini")' not in text:
    text = text.replace(connected_marker, connected_replacement, 1)

old_probe = '''    const [groqFree, nvidiaFree, cloudflareFree] = await Promise.all([
      publicSignal("https://console.groq.com/docs/rate-limits", /Free Plan Limits|free plan/i),
      publicSignal("https://build.nvidia.com/explore", /Free serverless APIs for development|Free Endpoint/i),
      publicSignal("https://developers.cloudflare.com/workers-ai/platform/pricing/", /10,000 Neurons per day|free allocation/i),
    ]);'''
new_probe = '''    const [groqFree, nvidiaFree, cloudflareFree, geminiFree, mistralFree, cohereFree, huggingFaceFree] = await Promise.all([
      publicSignal("https://console.groq.com/docs/rate-limits", /Free Plan Limits|free plan/i),
      publicSignal("https://build.nvidia.com/explore", /Free serverless APIs for development|Free Endpoint/i),
      publicSignal("https://developers.cloudflare.com/workers-ai/platform/pricing/", /10,000 Neurons per day|free allocation/i),
      publicSignal("https://ai.google.dev/gemini-api/docs/pricing", /Free Tier|Free of charge/i),
      publicSignal("https://mistral.ai/pricing/", /\\$10 \\/mo in API credits|Free plan/i),
      publicSignal("https://cohere.com/pricing", /Trial API key|trial keys are free|API calls made from a Trial API key are free/i),
      publicSignal("https://huggingface.co/docs/inference-providers/pricing", /Free Users|monthly credits|Free Credits to Get Started/i),
    ]);'''
if old_probe in text:
    text = text.replace(old_probe, new_probe, 1)
elif 'geminiFree' not in text:
    raise SystemExit('Radar provider probe marker not found')

insert_marker = '''      {
        id: "cloudflare",
        name: "Cloudflare Workers AI",
        kind: "cloudflare",
        description: "Asignación gratuita diaria de Workers AI; requiere Account ID además del token.",
        freeLabel: "Asignación gratuita diaria detectada",
        sourceUrl: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
        requiresAccountId: true,
        connected: connectedIds.has("cloudflare"),
        detected: cloudflareFree,
        checkedAt,
      },'''
extra = insert_marker + '''
      {
        id: "gemini",
        name: "Google Gemini API",
        kind: "openai-compatible",
        description: "Gemini Developer API con Free Tier para modelos compatibles.",
        freeLabel: "Free Tier detectado",
        sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        requiresAccountId: false,
        connected: connectedIds.has("gemini"),
        detected: geminiFree,
        checkedAt,
      },
      {
        id: "mistral",
        name: "Mistral API",
        kind: "openai-compatible",
        description: "Plan Free con créditos mensuales de API publicados por Mistral.",
        freeLabel: "Crédito mensual gratuito detectado",
        sourceUrl: "https://mistral.ai/pricing/",
        baseUrl: "https://api.mistral.ai/v1",
        requiresAccountId: false,
        connected: connectedIds.has("mistral"),
        detected: mistralFree,
        checkedAt,
      },
      {
        id: "cohere",
        name: "Cohere",
        kind: "openai-compatible",
        description: "Trial API key gratuita y limitada para evaluación y prototipos.",
        freeLabel: "Trial gratuito detectado",
        sourceUrl: "https://cohere.com/pricing",
        baseUrl: "https://api.cohere.ai/compatibility/v1",
        requiresAccountId: false,
        connected: connectedIds.has("cohere"),
        detected: cohereFree,
        checkedAt,
      },
      {
        id: "huggingface",
        name: "Hugging Face Inference Providers",
        kind: "openai-compatible",
        description: "Créditos gratuitos mensuales para Inference Providers mediante un único token.",
        freeLabel: "Crédito mensual gratuito detectado",
        sourceUrl: "https://huggingface.co/docs/inference-providers/pricing",
        baseUrl: "https://router.huggingface.co/v1",
        requiresAccountId: false,
        connected: connectedIds.has("huggingface"),
        detected: huggingFaceFree,
        checkedAt,
      },'''
if insert_marker in text and 'id: "gemini"' not in text:
    text = text.replace(insert_marker, extra, 1)

routes.write_text(text)

# ---------------------------------------------------------------------------
# 2) Cohere uses an OpenAI-compatible chat endpoint but exposes its model
#    catalog on /v1/models rather than /compatibility/v1/models.
# ---------------------------------------------------------------------------
text = ai.read_text()
old_branch = '''  } else if (provider.kind === "nvidia" || provider.kind === "openai-compatible") {
    models = await listOpenAICompatibleModels(provider);'''
new_branch = '''  } else if (provider.kind === "nvidia") {
    models = await listOpenAICompatibleModels(provider);
  } else if (provider.kind === "openai-compatible" && (provider.baseUrl ?? "").includes("api.cohere.ai/compatibility/v1")) {
    const payload = await requestJson(
      "https://api.cohere.ai/v1/models?endpoint=chat&page_size=1000",
      { method: "GET", headers: { authorization: `Bearer ${provider.apiKey}`, accept: "application/json" } },
      provider.apiKey,
    );
    const rows = Array.isArray(payload.models) ? payload.models : [];
    models = rows.map(asRecord).map((item) => {
      const id = typeof item.name === "string" ? item.name.trim() : "";
      const contextLength = typeof item.context_length === "number" ? item.context_length : undefined;
      return {
        id,
        capabilities: inferProviderModelCapabilities(id, contextLength),
        ...(contextLength ? { contextLength } : {}),
        publisher: "cohere",
      };
    }).filter((item) => item.id.length > 0);
  } else if (provider.kind === "openai-compatible") {
    models = await listOpenAICompatibleModels(provider);'''
if old_branch in text:
    text = text.replace(old_branch, new_branch, 1)
elif 'api.cohere.ai/v1/models?endpoint=chat' not in text:
    raise SystemExit('Provider catalog branch marker not found')
ai.write_text(text)

# ---------------------------------------------------------------------------
# 3) Frontend ids: cards remain provider-specific; all generic compatible
#    services still save as openai-compatible with their own base URL.
# ---------------------------------------------------------------------------
text = radar.read_text()
text = text.replace(
    "type RadarQuickProvider = 'groq' | 'nvidia' | 'cloudflare' | 'openrouter';",
    "type RadarQuickProvider = 'groq' | 'nvidia' | 'cloudflare' | 'openrouter' | 'gemini' | 'mistral' | 'cohere' | 'huggingface';",
    1,
)
radar.write_text(text)

# ---------------------------------------------------------------------------
# Self-checks.
# ---------------------------------------------------------------------------
rt = routes.read_text()
at = ai.read_text()
ui = radar.read_text()
checks = {
    'Gemini discovery': 'id: "gemini"' in rt,
    'Mistral discovery': 'id: "mistral"' in rt,
    'Cohere discovery': 'id: "cohere"' in rt,
    'Hugging Face discovery': 'id: "huggingface"' in rt,
    'Cohere catalog adapter': 'api.cohere.ai/v1/models?endpoint=chat' in at,
    'Frontend provider ids': "'huggingface'" in ui and "'gemini'" in ui,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit('Expanded Radar registry incomplete: ' + ', '.join(failed))

print('Radar free-provider registry expanded to 8 addable sources')
