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
# Radar quick-add: provider/account -> key -> automatic catalog.
# Reuses the generated createProvider mutation, so credentials go through the
# exact same encrypted server-side storage path as the Providers screen.
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

const radarQuickProviderLabels: Record<RadarQuickProvider, string> = {
  groq: 'Groq',
  nvidia: 'NVIDIA NIM',
  cloudflare: 'Cloudflare Workers AI',
  openrouter: 'OpenRouter',
};

function RadarQuickAddProvider({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const create = useCreateProvider();
  const [provider, setProvider] = useState<RadarQuickProvider>('openrouter');
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
    if (provider === 'cloudflare' && !accountId.trim()) {
      setError('Cloudflare también necesita el Account ID.');
      return;
    }

    const providerKind = provider === 'openrouter' ? 'openai-compatible' : provider;
    const baseUrl = provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1'
      : provider === 'cloudflare'
        ? `https://api.cloudflare.com/client/v4/accounts/${accountId.trim()}/ai/v1`
        : undefined;

    const data = {
      name: radarQuickProviderLabels[provider],
      kind: providerKind,
      apiKey: apiKey.trim(),
      model: '__auto__',
      ...(baseUrl ? { baseUrl } : {}),
      isDefault: false,
    } as ProviderInput;

    create.mutate(
      { data },
      {
        onSuccess: () => onAdded(),
        onError: () => setError('No se pudo conectar la cuenta. Revisá la Key y los datos del proveedor.'),
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 backdrop-blur-sm md:items-center md:p-6" data-testid="modal-radar-quick-add">
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto border border-border bg-background shadow-2xl">
        <div className="flex items-start justify-between border-b border-border px-6 py-5">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">Radar / Alta rápida</div>
            <h2 className="mt-2 text-2xl font-semibold">Sumar proveedor</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Pegá una sola Key. Router guarda la credencial cifrada y Radar descubre el catálogo completo de esa cuenta.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="button-close-radar-quick-add">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-5 p-6">
          <label className="block">
            <span className="field-label">Proveedor</span>
            <select
              className="field-input"
              value={provider}
              onChange={event => {
                setProvider(event.target.value as RadarQuickProvider);
                setError('');
              }}
              data-testid="select-radar-quick-provider"
            >
              <option value="openrouter">OpenRouter</option>
              <option value="groq">Groq</option>
              <option value="nvidia">NVIDIA NIM</option>
              <option value="cloudflare">Cloudflare Workers AI</option>
            </select>
          </label>

          {provider === 'cloudflare' && (
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
                placeholder={`Pegá la Key de ${radarQuickProviderLabels[provider]}`}
                autoComplete="new-password"
                autoFocus
                data-testid="input-radar-provider-api-key"
              />
            </div>
          </label>

          <div className="rounded-lg border border-primary/15 bg-primary/5 p-3.5 text-xs leading-5 text-muted-foreground">
            No elegís modelo. La cuenta se guarda como catálogo automático y Router elige el modelo adecuado para cada tarea.
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
              Conectar y descubrir
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

'''

page_marker = 'export default function RadarPage() {'
if 'function RadarQuickAddProvider(' not in text:
    if page_marker not in text:
        raise SystemExit('Radar page marker not found')
    text = text.replace(page_marker, quick_add_component + page_marker, 1)

# State.
state_marker = "  const [publisherFilter, setPublisherFilter] = useState('all');\n"
if 'quickAddOpen' not in text:
    if state_marker not in text:
        raise SystemExit('Radar state marker not found')
    text = text.replace(state_marker, state_marker + "  const [quickAddOpen, setQuickAddOpen] = useState(false);\n", 1)

# Header actions: keep refresh, add direct provider connection beside it.
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
new_header_button = '''        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setQuickAddOpen(true)}
            data-testid="button-radar-add-provider"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus size={16} />
            Sumar proveedor
          </button>
          <button
            type="button"
            onClick={() => { void radarQuery.refetch(); void providersQuery.refetch(); }}
            disabled={radarQuery.isFetching || providersQuery.isFetching}
            data-testid="button-refresh-radar"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm font-semibold hover:bg-muted disabled:opacity-60"
          >
            <RefreshCw size={15} className={radarQuery.isFetching ? 'animate-spin' : ''} />
            Actualizar señal
          </button>
        </div>'''
if old_header_button in text:
    text = text.replace(old_header_button, new_header_button, 1)
elif 'button-radar-add-provider' not in text:
    raise SystemExit('Radar header refresh button marker not found')

# Mount modal inside the Radar page. Refetch both sources after successful create,
# which immediately exposes the account catalog without navigating away.
root_close = '''      <div className="mt-6 flex flex-col gap-4 border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between" data-testid="section-radar-next-step">'''
if root_close not in text:
    raise SystemExit('Radar next-step marker not found')

modal_mount = '''      {quickAddOpen && (
        <RadarQuickAddProvider
          onClose={() => setQuickAddOpen(false)}
          onAdded={() => {
            setQuickAddOpen(false);
            void providersQuery.refetch();
            void radarQuery.refetch();
          }}
        />
      )}

'''
if 'onAdded={() =>' not in text:
    text = text.replace(root_close, modal_mount + root_close, 1)

p.write_text(text)
print('Radar quick-add provider flow installed')
