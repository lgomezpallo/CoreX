import { useEffect, useState } from "react";
import { AlertCircle, Check, CircleHelp, LoaderCircle, LogOut, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useAuthenticatedUser } from "@/components/auth-gate";
import {
  getListRouterProvidersQueryKey,
  useCreateRouterProvider,
  useDeleteRouterProvider,
  useListRouterProviders,
  useTestRouterProvider,
  useUpdateRouterProvider,
  type RouterProvider,
  type RouterProviderInput,
  type RouterProviderUpdate,
} from "@workspace/api-client-react";

const kinds = ["openai", "anthropic", "gemini", "groq", "openai-compatible"] as const;
const capabilities = ["chat", "coding", "reasoning", "summarization", "vision", "document"] as const;
type Kind = typeof kinds[number];
type Capability = typeof capabilities[number];
type Draft = {
  name: string;
  kind: Kind;
  model: string;
  apiKey: string;
  baseUrl: string;
  priority: string;
  isDefault: boolean;
  isActive: boolean;
  capabilities: Capability[];
};

const emptyDraft = (): Draft => ({
  name: "",
  kind: "openai",
  model: "",
  apiKey: "",
  baseUrl: "",
  priority: "0",
  isDefault: false,
  isActive: true,
  capabilities: ["chat"],
});

const labels: Record<string, string> = {
  chat: "Chat",
  coding: "Código",
  reasoning: "Razonamiento",
  summarization: "Resumen",
  vision: "Visión",
  document: "Documento",
};

const healthLabels: Record<string, string> = {
  available: "Sin probar",
  untested: "Sin probar",
  healthy: "Conectado",
  connected: "Conectado",
  unavailable: "Sin conexión",
  error: "Error",
};

const GROQ_PRESET: RouterProviderInput = {
  name: "Groq",
  kind: "groq",
  model: "qwen/qwen3.8-27b",
  apiKey: "",
  baseUrl: null,
  priority: 100,
  isDefault: true,
  isActive: true,
  capabilities: ["chat", "coding", "reasoning", "summarization", "document"],
};

function apiError(error: unknown): string {
  if (typeof error === "object" && error && "data" in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return "No se pudo completar la operación. Intentá de nuevo.";
}

function providerHealthLabel(provider: RouterProvider): string {
  return healthLabels[provider.healthStatus] ??
    healthLabels[provider.status] ??
    provider.healthStatus ??
    provider.status;
}

export function RouterSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, signOut, previewMode } = useAuthenticatedUser();
  const queryClient = useQueryClient();
  const providers = useListRouterProviders({ query: { enabled: open, queryKey: getListRouterProvidersQueryKey() } });
  const create = useCreateRouterProvider();
  const update = useUpdateRouterProvider();
  const remove = useDeleteRouterProvider();
  const test = useTestRouterProvider();
  const form = useForm<Draft>({ defaultValues: emptyDraft() });
  const draft = form.watch();
  const [editing, setEditing] = useState<RouterProvider | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [groqKey, setGroqKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!open) {
      setFormOpen(false);
      setEditing(null);
      setAdvancedOpen(false);
      setGroqKey("");
      setSigningOut(false);
    }
  }, [open]);

  if (!open) return null;

  const busy = create.isPending || update.isPending || remove.isPending || test.isPending;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListRouterProvidersQueryKey() });
  const hasGroq = Boolean(providers.data?.some((provider) => provider.kind === "groq"));

  const connectGroq = () => {
    const apiKey = groqKey.trim();
    setError(null);
    setNotice(null);
    if (!apiKey) {
      setError("Pegá la clave API de Groq.");
      return;
    }
    create.mutate(
      { data: { ...GROQ_PRESET, apiKey } },
      {
        onSuccess: (provider: RouterProvider) => {
          setGroqKey("");
          invalidate();
          setNotice("Groq agregado. Probando conexión…");
          test.mutate(
            { providerId: provider.id },
            {
              onSuccess: (result) => {
                if (result.ok) {
                  setNotice(`Groq conectado (${result.latencyMs ?? "—"} ms).`);
                } else {
                  setError(result.message);
                  setNotice(null);
                }
                invalidate();
              },
              onError: (e) => {
                setError(apiError(e));
                setNotice(null);
                invalidate();
              },
            },
          );
        },
        onError: (e) => setError(apiError(e)),
      },
    );
  };

  const beginAdd = () => {
    setEditing(null);
    form.reset(emptyDraft());
    setError(null);
    setFormOpen(true);
  };

  const beginEdit = (provider: RouterProvider) => {
    setEditing(provider);
    form.reset({
      name: provider.name,
      kind: provider.kind,
      model: provider.model,
      apiKey: "",
      baseUrl: provider.baseUrl ?? "",
      priority: String(provider.priority),
      isDefault: provider.isDefault,
      isActive: provider.isActive,
      capabilities: provider.capabilities as Capability[],
    });
    setError(null);
    setFormOpen(true);
    setAdvancedOpen(true);
  };

  const submit = (nextDraft: Draft) => {
    setError(null);
    if (!nextDraft.name.trim() || !nextDraft.model.trim() || (!editing && !nextDraft.apiKey.trim())) {
      setError("Completá nombre, modelo y clave API.");
      return;
    }
    if (nextDraft.capabilities.length === 0) {
      setError("Seleccioná al menos una capacidad.");
      return;
    }
    const common = {
      name: nextDraft.name.trim(),
      model: nextDraft.model.trim(),
      isDefault: nextDraft.isDefault,
      isActive: nextDraft.isActive,
      priority: Number(nextDraft.priority) || 0,
      capabilities: nextDraft.capabilities,
    };
    if (editing) {
      const data: RouterProviderUpdate = {
        ...common,
        ...(editing.kind === "openai-compatible" ? { baseUrl: nextDraft.baseUrl.trim() || null } : {}),
        ...(nextDraft.apiKey.trim() ? { apiKey: nextDraft.apiKey.trim() } : {}),
      };
      update.mutate(
        { providerId: editing.id, data },
        {
          onSuccess: () => {
            setFormOpen(false);
            setNotice("Proveedor actualizado.");
            invalidate();
          },
          onError: (e) => setError(apiError(e)),
        },
      );
    } else {
      const data: RouterProviderInput = {
        ...common,
        kind: nextDraft.kind,
        baseUrl: nextDraft.kind === "openai-compatible" ? nextDraft.baseUrl.trim() || null : null,
        apiKey: nextDraft.apiKey.trim(),
      };
      create.mutate(
        { data },
        {
          onSuccess: () => {
            setFormOpen(false);
            setNotice("Proveedor agregado.");
            invalidate();
          },
          onError: (e) => setError(apiError(e)),
        },
      );
    }
  };

  const deleteProvider = (provider: RouterProvider) => {
    if (!window.confirm(`¿Eliminar el proveedor "${provider.name}"?`)) return;
    remove.mutate(
      { providerId: provider.id },
      {
        onSuccess: () => {
          setNotice("Proveedor eliminado.");
          invalidate();
        },
        onError: (e) => setError(apiError(e)),
      },
    );
  };

  const testProvider = (provider: RouterProvider) => {
    setNotice(null);
    setError(null);
    test.mutate(
      { providerId: provider.id },
      {
        onSuccess: (result) => {
          if (result.ok) setNotice(`La conexión de ${provider.name} funciona (${result.latencyMs ?? "—"} ms).`);
          else setError(result.message);
          invalidate();
        },
        onError: (e) => setError(apiError(e)),
      },
    );
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    setError(null);
    try {
      await signOut();
    } catch {
      setError("No pude cerrar la sesión.");
      setSigningOut(false);
    }
  };

  return (
    <div className="builder-provider-settings-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="builder-provider-settings" role="dialog" aria-modal="true" aria-labelledby="router-settings-title">
        <header className="builder-provider-settings-header">
          <div>
            <span className="builder-provider-settings-eyebrow">COREX</span>
            <h2 id="router-settings-title">Configuración</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar configuración" data-testid="button-close-router-settings"><X size={18} /></button>
        </header>

        <div className="builder-provider-settings-content">
          <div className="builder-provider-card">
            <div className="builder-provider-card-heading">
              <div>
                <h4>Cuenta</h4>
                <p>{previewMode ? "Vista previa de desarrollo" : "Cuenta de propietario"}</p>
              </div>
            </div>
            {!previewMode && (
              <>
                <p className="builder-provider-settings-note">{user?.email ?? "Cuenta de propietario"}</p>
                <button type="button" className="builder-provider-test-button" onClick={() => void handleSignOut()} disabled={signingOut}>
                  <LogOut size={14} /> {signingOut ? "Saliendo…" : "Cerrar sesión"}
                </button>
              </>
            )}
          </div>

          <div className="builder-provider-list-heading">
            <div><h3>IA y proveedores</h3><p>CoreX configura automáticamente los proveedores conocidos.</p></div>
            <button type="button" className="builder-provider-refresh" onClick={() => void providers.refetch()} disabled={providers.isFetching} aria-label="Actualizar proveedores" data-testid="button-refresh-providers">
              {providers.isFetching ? <LoaderCircle size={15} className="builder-spin" /> : <RefreshCw size={15} />}
            </button>
          </div>

          {error && <p className="builder-provider-settings-error" role="alert"><AlertCircle size={15} />{error}</p>}
          {notice && <p className="builder-provider-test-result is-passed" role="status"><Check size={14} />{notice}</p>}
          {providers.isLoading && <p className="builder-provider-settings-note" role="status"><LoaderCircle size={15} className="builder-spin" /> Cargando proveedores…</p>}
          {providers.isError && !providers.isLoading && <p className="builder-provider-settings-error" role="alert"><AlertCircle size={15} />{apiError(providers.error)}</p>}

          {!hasGroq && !providers.isLoading && !providers.isError && (
            <form
              className="builder-provider-card"
              onSubmit={(event) => {
                event.preventDefault();
                connectGroq();
              }}
              data-testid="quick-connect-groq"
            >
              <div className="builder-provider-card-heading">
                <div>
                  <h4>Groq</h4>
                  <p>Configuración automática</p>
                </div>
                <span className="builder-provider-status">Recomendado</span>
              </div>
              <p className="builder-provider-settings-note">Pegá tu clave y CoreX configura modelo, prioridad, capacidades y estado. Después prueba la conexión solo.</p>
              <input
                value={groqKey}
                onChange={(event) => setGroqKey(event.target.value)}
                type="password"
                autoComplete="new-password"
                placeholder="Clave API de Groq"
                aria-label="Clave API de Groq"
                data-testid="input-quick-groq-key"
              />
              <button type="submit" className="builder-provider-test-all" disabled={busy || !groqKey.trim()} data-testid="button-connect-groq">
                {create.isPending || test.isPending ? <LoaderCircle size={15} className="builder-spin" /> : <Check size={15} />}
                {create.isPending ? "Agregando…" : test.isPending ? "Probando…" : "Conectar Groq"}
              </button>
            </form>
          )}

          {providers.data?.map((provider) => (
            <article className="builder-provider-card" key={provider.id} data-testid={`card-provider-${provider.id}`}>
              <div className="builder-provider-card-heading">
                <div><h4>{provider.name}</h4><p>{provider.kind} · {provider.model} · clave configurada</p></div>
                <span className={`builder-provider-status ${provider.isActive ? "" : "is-suspended"}`}>{provider.isActive ? (provider.isDefault ? "Predeterminado" : "Activo") : "Inactivo"}</span>
              </div>
              <div className="builder-provider-capabilities">{provider.capabilities.map((capability) => <span key={capability}>{labels[capability] ?? capability}</span>)}</div>
              <p className="builder-provider-settings-note">Prioridad {provider.priority} · {providerHealthLabel(provider)}{provider.lastTestAt ? ` · Probado ${new Date(provider.lastTestAt).toLocaleString("es-AR")}` : ""}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                <button type="button" className="builder-provider-test-button" onClick={() => testProvider(provider)} disabled={test.isPending}><Check size={14} />{test.isPending ? "Probando…" : "Probar"}</button>
                <button type="button" className="builder-provider-test-button" onClick={() => beginEdit(provider)}><Pencil size={14} />Editar</button>
                <button type="button" className="builder-provider-test-button" onClick={() => deleteProvider(provider)} disabled={busy}><Trash2 size={14} />Eliminar</button>
              </div>
            </article>
          ))}

          <button type="button" className="builder-provider-test-button" onClick={() => setAdvancedOpen((value) => !value)}>
            <Plus size={14} /> {advancedOpen ? "Ocultar configuración avanzada" : "Configuración avanzada"}
          </button>

          {advancedOpen && (
            <>
              <button type="button" className="builder-provider-test-all" onClick={beginAdd}><Plus size={15} /> Agregar proveedor manualmente</button>
              {formOpen && <Form {...form}>
                <form className="builder-provider-card" onSubmit={form.handleSubmit(submit)} aria-label={editing ? "Editar proveedor" : "Agregar proveedor"}>
                  <div className="builder-provider-card-heading"><h4>{editing ? "Editar proveedor" : "Agregar proveedor"}</h4><button type="button" onClick={() => setFormOpen(false)} aria-label="Cancelar"><X size={16} /></button></div>
                  <FormField control={form.control} name="name" rules={{ required: "Completá el nombre." }} render={({ field }) => (
                    <FormItem><FormLabel>Nombre</FormLabel><FormControl><input {...field} required /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="kind" render={({ field }) => (
                    <FormItem><FormLabel>Tipo</FormLabel><FormControl><select {...field} disabled={Boolean(editing)}>{kinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="model" rules={{ required: "Completá el modelo." }} render={({ field }) => (
                    <FormItem><FormLabel>Modelo</FormLabel><FormControl><input {...field} required /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="apiKey" rules={!editing ? { required: "Completá la clave API." } : undefined} render={({ field }) => (
                    <FormItem><FormLabel>Clave API {editing ? "(opcional para reemplazarla)" : ""}</FormLabel><FormControl><input {...field} required={!editing} type="password" autoComplete="new-password" /></FormControl><FormMessage /></FormItem>
                  )} />
                  {draft.kind === "openai-compatible" && <FormField control={form.control} name="baseUrl" rules={{ required: "Completá la URL pública HTTPS del proveedor." }} render={({ field }) => (
                    <FormItem><FormLabel>URL base</FormLabel><FormControl><input {...field} required type="url" /></FormControl><FormMessage /></FormItem>
                  )} />}
                  <FormField control={form.control} name="priority" rules={{ required: "Indicá la prioridad." }} render={({ field }) => (
                    <FormItem><FormLabel>Prioridad</FormLabel><FormControl><input {...field} type="number" min="0" max="1000" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="capabilities" render={({ field }) => (
                    <FormItem><fieldset><legend>Capacidades</legend>{capabilities.map((capability) => <label key={capability}><input type="checkbox" name={field.name} ref={field.ref} checked={field.value.includes(capability)} onBlur={field.onBlur} onChange={(event) => field.onChange(event.target.checked ? [...field.value, capability] : field.value.filter((item) => item !== capability))} />{labels[capability]}</label>)}</fieldset><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="isDefault" render={({ field }) => (
                    <FormItem><label><FormControl><input type="checkbox" name={field.name} ref={field.ref} checked={field.value} onBlur={field.onBlur} onChange={(event) => field.onChange(event.target.checked)} /></FormControl> Usar como predeterminado</label><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="isActive" render={({ field }) => (
                    <FormItem><label><FormControl><input type="checkbox" name={field.name} ref={field.ref} checked={field.value} onBlur={field.onBlur} onChange={(event) => field.onChange(event.target.checked)} /></FormControl> Activo</label><FormMessage /></FormItem>
                  )} />
                  <button type="submit" className="builder-provider-test-all" disabled={busy}>{busy ? "Guardando…" : editing ? "Guardar cambios" : "Agregar proveedor"}</button>
                </form>
              </Form>}
            </>
          )}

          <p className="builder-provider-settings-note"><CircleHelp size={14} /> Las claves se cifran del lado del servidor y nunca se devuelven en las respuestas.</p>
        </div>
      </section>
    </div>
  );
}