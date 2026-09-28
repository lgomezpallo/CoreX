from pathlib import Path

# ---------------------------------------------------------------------------
# Normalize provider account model UI in the main Providers form.
# ---------------------------------------------------------------------------
p = Path('/tmp/router-export/artifacts/router-ia/src/App.tsx')
text = p.read_text()

start_marker = "            {values.kind === 'cloudflare' || values.kind === 'groq' || values.kind === 'nvidia' ? ("
end_marker = "            {values.kind === 'cloudflare' && ("
start = text.find(start_marker)
end = text.find(end_marker, start + 1)
if start < 0 or end < 0 or end <= start:
    raise SystemExit('Account model UI markers not found')

block = '''            {(['cloudflare', 'groq', 'nvidia'] as string[]).includes(values.kind) ? (
              <div className="rounded-lg border border-border bg-card p-3.5 sm:col-span-2" data-testid="provider-account-catalog">
                <div className="field-label">Modelos</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {values.kind === 'cloudflare'
                    ? 'Catálogo automático de Workers AI.'
                    : values.kind === 'groq'
                      ? 'Catálogo automático de tu cuenta Groq.'
                      : 'Catálogo automático de NVIDIA NIM.'}{' '}
                  Router IA descubre los modelos disponibles y elige según la tarea.
                </p>
              </div>
            ) : (
              <ModelAutocomplete
                providerKind={values.kind}
                value={values.model}
                onChange={(model) => set('model', model)}
              />
            )}
'''

text = text[:start] + block + text[end:]
p.write_text(text)
print('Provider account UI model block normalized')

# ---------------------------------------------------------------------------
# Radar backend: discover addable providers with a currently visible free
# access signal. This is intentionally separate from model discovery: Radar
# first discovers the provider, then the user's key unlocks its full catalog.
# ---------------------------------------------------------------------------
p = Path('/tmp/router-export/artifacts/api-server/src/routes/ai-router.ts')
text = p.read_text()

old_backend = '''    const catalog = ListRadarModelsResponse.parse(merged);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.json(catalog);'''

new_backend = r'''    const catalog = ListRadarModelsResponse.parse(merged);

    type RadarProviderSignal = {
      id: "openrouter" | "groq" | "nvidia" | "cloudflare";
      name: string;
      kind: "openai-compatible" | "groq" | "nvidia" | "cloudflare";
      description: string;
      freeLabel: string;
      sourceUrl: string;
      baseUrl?: string;
      requiresAccountId: boolean;
      connected: boolean;
      detected: boolean;
      checkedAt: string;
      zeroCostModels?: number;
    };

    const connectedIds = new Set<string>();
    for (const provider of accountRows) {
      if (provider.kind === "groq") connectedIds.add("groq");
      if (provider.kind === "nvidia") connectedIds.add("nvidia");
      if (provider.kind === "cloudflare") connectedIds.add("cloudflare");
      if (provider.kind === "openai-compatible" && (provider.baseUrl ?? "").includes("openrouter.ai")) connectedIds.add("openrouter");
    }

    async function publicSignal(url: string, pattern: RegExp): Promise<boolean> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: { accept: "text/html,application/json", "user-agent": "Router-IA-Radar/1.0" },
          signal: controller.signal,
        });
        if (!response.ok) return false;
        const body = (await response.text()).slice(0, 1_500_000);
        return pattern.test(body);
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    }

    const checkedAt = new Date().toISOString();
    const [groqFree, nvidiaFree, cloudflareFree] = await Promise.all([
      publicSignal("https://console.groq.com/docs/rate-limits", /Free Plan Limits|free plan/i),
      publicSignal("https://build.nvidia.com/explore", /Free serverless APIs for development|Free Endpoint/i),
      publicSignal("https://developers.cloudflare.com/workers-ai/platform/pricing/", /10,000 Neurons per day|free allocation/i),
    ]);

    const discoveredProviders: RadarProviderSignal[] = [
      {
        id: "openrouter",
        name: "OpenRouter",
        kind: "openai-compatible",
        description: "Acceso unificado a modelos gratuitos publicados por OpenRouter.",
        freeLabel: `${publicCatalog.zeroCostModels ?? 0} modelos con precio cero detectados`,
        sourceUrl: "https://openrouter.ai/api/v1/models",
        baseUrl: "https://openrouter.ai/api/v1",
        requiresAccountId: false,
        connected: connectedIds.has("openrouter"),
        detected: (publicCatalog.zeroCostModels ?? 0) > 0,
        checkedAt,
        zeroCostModels: publicCatalog.zeroCostModels ?? 0,
      },
      {
        id: "groq",
        name: "Groq",
        kind: "groq",
        description: "Plan Free con límites publicados; la Key habilita el catálogo de tu cuenta.",
        freeLabel: "Plan Free detectado",
        sourceUrl: "https://console.groq.com/docs/rate-limits",
        requiresAccountId: false,
        connected: connectedIds.has("groq"),
        detected: groqFree,
        checkedAt,
      },
      {
        id: "nvidia",
        name: "NVIDIA NIM",
        kind: "nvidia",
        description: "Endpoints serverless gratuitos para desarrollo y evaluación.",
        freeLabel: "Endpoints gratuitos detectados",
        sourceUrl: "https://build.nvidia.com/explore",
        requiresAccountId: false,
        connected: connectedIds.has("nvidia"),
        detected: nvidiaFree,
        checkedAt,
      },
      {
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
      },
    ].filter((provider) => provider.detected || provider.connected);

    res.setHeader("Cache-Control", "private, max-age=60");
    res.json({ ...catalog, discoveredProviders });'''

if old_backend in text:
    text = text.replace(old_backend, new_backend, 1)
elif 'discoveredProviders' not in text:
    raise SystemExit('Radar backend response marker not found')
p.write_text(text)
print('Radar free-provider discovery installed')

# ---------------------------------------------------------------------------
# Radar frontend: show the providers Radar discovered. Adding starts from a
# specific discovered provider card; there is no generic provider picker.
# ---------------------------------------------------------------------------
p = Path('/tmp/router-export/artifacts/router-ia/src/pages/radar.tsx')
text = p.read_text()

# Imports.
text = text.replace(
    "  Layers3,\n  RefreshCw,",
    "  Layers3,\n  KeyRound,\n  Loader2,\n  Plus,\n  RefreshCw,",
    1,
)
text = text.replace(
    "  useListProviders,\n  useListRadarModels,\n  type Provider,",
    "  useCreateProvider,\n  useListProviders,\n  useListRadarModels,\n  type Provider,\n  type ProviderInput,",
    1,
)

quick_add_component = r'''
type RadarQuickProvider = 'groq' | 'nvidia' | 'cloudflare' | 'openrouter';

type RadarDiscoveredProvider = {
  id: RadarQuickProvider;
  name: string;
  kind: 'openai-compatible' | 'groq' | 'nvidia' | 'cloudflare';
  description: string;
  freeLabel: string;
  sourceUrl: string;
  baseUrl?: string;
  requiresAccountId: boolean;
  connected: boolean;
  detected: boolean;
  checkedAt: string;
  zeroCostModels?: number;
};

function RadarQuickAddProvider({ provider, onClose, onAdded }: { provider: RadarDiscoveredProvider; onClose: () => void; onAdded: () => void }) {
  const create = useCreateProvider();
  const [apiKey, setApiKey] = useState('');
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!apiKey.trim()) {
      setError('Pegá la Key del proveedor.');
      return;
    }
    if (provider.requiresAccountId && !accountId.trim()) {
      setError('Cloudflare también necesita el Account ID.');
      return;
    }

    const baseUrl = provider.id === 'cloudflare'
      ? `https://api.cloudflare.com/client/v4/accounts/${accountId.trim()}/ai/v1`
      : provider.baseUrl;

    const data = {
      name: provider.name,
      kind: provider.kind,
      apiKey: apiKey.trim(),
      model: '__auto__',
      ...(baseUrl ? { baseUrl } : {}),
      isDefault: false,
    } as ProviderInput;

    create.mutate(
      { data },
      {
        onSuccess: () => onAdded(),
        onError: () => setError('No se pudo conectar. Revisá la Key y los datos de la cuenta.'),
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 backdrop-blur-sm md:items-center md:p-6" data-testid="modal-radar-quick-add">
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto border border-border bg-background shadow-2xl">
        <div className="flex items-start justify-between border-b border-border px-6 py-5">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">Radar / Proveedor detectado</div>
            <h2 className="mt-2 text-2xl font-semibold">Sumar {provider.name}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {provider.freeLabel}. Pegá la credencial y Radar incorpora el catálogo disponible de tu cuenta.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="button-close-radar-quick-add">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-5 p-6">
          {provider.requiresAccountId && (
            <label className="block">
              <span className="field-label">Cloudflare Account ID</span>
              <input
                className="field-input font-mono"
                value={accountId}
                onChange={event => setAccountId(event.target.value)}
                placeholder="Account ID"
                autoComplete="off"
                data-testid="input-radar-cloudflare-account-id"
              />
            </label>
          )}

          <label className="block">
            <span className="field-label">API Key</span>
            <div className="relative">
              <KeyRound size={15} className="pointer-events-none absolute left-3 top-3.5 text-muted-foreground" />
              <input
                type="password"
                className="field-input pl-9 font-mono"
                value={apiKey}
                onChange={event => setApiKey(event.target.value)}
                placeholder={`Pegá la Key de ${provider.name}`}
                autoComplete="new-password"
                autoFocus
                data-testid="input-radar-provider-api-key"
              />
            </div>
          </label>

          <div className="rounded-lg border border-primary/15 bg-primary/5 p-3.5 text-xs leading-5 text-muted-foreground">
            No elegís modelos. La cuenta queda en catálogo automático y Router elige entre los modelos que Radar encuentre con esa credencial.
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 p-3 text-xs leading-5 text-destructive" data-testid="status-radar-quick-add-error">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-5">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold hover:bg-muted">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              data-testid="button-save-radar-provider"
            >
              {create.isPending && <Loader2 size={15} className="animate-spin" />}
              Conectar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

'''

page_marker = 'export default function RadarPage() {'
if 'type RadarDiscoveredProvider =' not in text:
    if page_marker not in text:
        raise SystemExit('Radar page marker not found')
    text = text.replace(page_marker, quick_add_component + page_marker, 1)

# Replace any previous generic quick-add component, if this script is applied
# after an earlier version in a local reproduction.
if 'function RadarQuickAddProvider({ onClose, onAdded }' in text:
    raise SystemExit('Old generic Radar quick-add component still present')

# State.
state_marker = "  const [publisherFilter, setPublisherFilter] = useState('all');\n"
if 'selectedProvider' not in text:
    if state_marker not in text:
        raise SystemExit('Radar state marker not found')
    text = text.replace(state_marker, state_marker + "  const [selectedProvider, setSelectedProvider] = useState<RadarDiscoveredProvider | null>(null);\n", 1)

# Derived discovered-provider list, carried as a backwards-compatible extension
# of the existing Radar response.
derived_marker = "  const models = catalog?.models ?? [];\n"
if 'const discoveredProviders =' not in text:
    text = text.replace(
        derived_marker,
        derived_marker + "  const discoveredProviders = ((catalog as unknown as { discoveredProviders?: RadarDiscoveredProvider[] } | undefined)?.discoveredProviders ?? []);\n",
        1,
    )

# Header: refresh only. Provider addition belongs to the discovered list itself.
old_header_button = '''        <button
          type="button"
          onClick={() => { void radarQuery.refetch(); void providersQuery.refetch(); }}
          disabled={radarQuery.isFetching || providersQuery.isFetching}
          data-testid="button-refresh-radar"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm font-semibold hover:bg-muted disabled:opacity-60"
        >
          <RefreshCw size={15} className={radarQuery.isFetching ? 'animate-spin' : ''} />
          Actualizar señal
        </button>'''
if old_header_button not in text:
    raise SystemExit('Radar header refresh button marker not found')

# Provider-discovery section, inserted immediately after the observation hero.
hero_close = '''      </section>

      {!hasModels ? ('''
provider_section = r'''      </section>

      <section className="mt-6 border border-border bg-card" data-testid="section-radar-free-providers">
        <div className="flex flex-col gap-2 border-b border-border px-5 py-5 md:px-6">
          <div className="flex items-center gap-2">
            <Plus size={17} className="text-primary" />
            <h2 className="font-semibold">Proveedores gratis encontrados</h2>
          </div>
          <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
            Radar revisa señales públicas de acceso gratuito. Elegí uno de los encontrados, pegá su Key y queda incorporado al Router sin elegir modelos a mano.
          </p>
        </div>
        {discoveredProviders.length === 0 ? (
          <div className="px-6 py-8 text-sm text-muted-foreground">
            En esta lectura no se pudo verificar ningún proveedor gratuito compatible. Usá “Actualizar señal” para volver a revisar.
          </div>
        ) : (
          <div className="grid gap-px bg-border md:grid-cols-2">
            {discoveredProviders.map(provider => (
              <article key={provider.id} className="bg-card p-5" data-testid={`card-radar-provider-${provider.id}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{provider.name}</h3>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[.08em] text-primary">
                        Gratis detectado
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{provider.description}</p>
                    <p className="mt-3 font-mono text-[10px] uppercase tracking-[.08em] text-muted-foreground">{provider.freeLabel}</p>
                  </div>
                  {provider.connected ? (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary">
                      <Check size={14} /> Conectado
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSelectedProvider(provider)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
                      data-testid={`button-radar-add-${provider.id}`}
                    >
                      <Plus size={14} /> Sumar
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {!hasModels ? ('''
if hero_close not in text:
    raise SystemExit('Radar hero close marker not found')
text = text.replace(hero_close, provider_section, 1)

# Mount provider-specific modal.
next_step = '''      <div className="mt-6 flex flex-col gap-4 border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between" data-testid="section-radar-next-step">'''
modal_mount = '''      {selectedProvider && (
        <RadarQuickAddProvider
          provider={selectedProvider}
          onClose={() => setSelectedProvider(null)}
          onAdded={() => {
            setSelectedProvider(null);
            void providersQuery.refetch();
            void radarQuery.refetch();
          }}
        />
      )}

'''
if next_step not in text:
    raise SystemExit('Radar next-step marker not found')
if 'provider={selectedProvider}' not in text:
    text = text.replace(next_step, modal_mount + next_step, 1)

p.write_text(text)
print('Radar discovered-provider cards and inline key flow installed')

# ---------------------------------------------------------------------------
# Self-checks: prevent another green build that silently keeps the old UX.
# ---------------------------------------------------------------------------
routes = Path('/tmp/router-export/artifacts/api-server/src/routes/ai-router.ts').read_text()
radar = Path('/tmp/router-export/artifacts/router-ia/src/pages/radar.tsx').read_text()
checks = {
    'backend discovered providers': 'discoveredProviders: RadarProviderSignal[]' in routes,
    'public free probes': 'Free serverless APIs for development' in routes and '10,000 Neurons per day' in routes,
    'Radar provider list': 'Proveedores gratis encontrados' in radar,
    'provider-specific add': 'button-radar-add-${provider.id}' in radar,
    'no generic provider picker': 'select-radar-quick-provider' not in radar,
    'provider-specific modal': 'provider={selectedProvider}' in radar,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit('Radar provider discovery patch incomplete: ' + ', '.join(failed))

print('Radar provider discovery UX verified')
