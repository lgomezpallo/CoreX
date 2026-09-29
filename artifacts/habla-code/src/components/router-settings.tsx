import { useEffect, useState } from "react";
import { AlertCircle, Check, CircleHelp, LoaderCircle, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
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
  name: string; kind: Kind; model: string; apiKey: string; baseUrl: string;
  priority: string; isDefault: boolean; isActive: boolean; capabilities: Capability[];
};
const emptyDraft = (): Draft => ({
  name: "", kind: "openai", model: "", apiKey: "", baseUrl: "", priority: "0",
  isDefault: false, isActive: true, capabilities: ["chat"],
});
const labels: Record<string, string> = {
  chat: "Chat", coding: "Código", reasoning: "Razonamiento", summarization: "Resumen",
  vision: "Visión", document: "Documento",
};
const healthLabels: Record<string, string> = {
  available: "Sin probar",
  untested: "Sin probar",
  healthy: "Conectado",
  connected: "Conectado",
  unavailable: "Sin conexión",
  error: "Error",
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setFormOpen(false); setEditing(null); }
  }, [open]);
  if (!open) return null;

  const busy = create.isPending || update.isPending || remove.isPending;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListRouterProvidersQueryKey() });
  const beginAdd = () => { setEditing(null); form.reset(emptyDraft()); setError(null); setFormOpen(true); };
  const beginEdit = (provider: RouterProvider) => {
    setEditing(provider);
    form.reset({
      name: provider.name, kind: provider.kind, model: provider.model, apiKey: "", baseUrl: provider.baseUrl ?? "",
      priority: String(provider.priority), isDefault: provider.isDefault, isActive: provider.isActive,
      capabilities: provider.capabilities as Capability[],
    });
    setError(null); setFormOpen(true);
  };
  const submit = (draft: Draft) => {
    setError(null);
    if (!draft.name.trim() || !draft.model.trim() || (!editing && !draft.apiKey.trim())) {
      setError("Completá nombre, modelo y clave API."); return;
    }
    if (draft.capabilities.length === 0) {
      setError("Seleccioná al menos una capacidad."); return;
    }
    const common = {
      name: draft.name.trim(), model: draft.model.trim(),
      isDefault: draft.isDefault, isActive: draft.isActive, priority: Number(draft.priority) || 0,
      capabilities: draft.capabilities,
    };
    if (editing) {
      const data: RouterProviderUpdate = {
        ...common,
        ...(editing.kind === "openai-compatible" ? { baseUrl: draft.baseUrl.trim() || null } : {}),
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      };
      update.mutate({ providerId: editing.id, data }, {
        onSuccess: () => { setFormOpen(false); setNotice("Proveedor actualizado."); invalidate(); },
        onError: (e) => setError(apiError(e)),
      });
    } else {
      const data: RouterProviderInput = {
        ...common,
        kind: draft.kind,
        baseUrl: draft.kind === "openai-compatible" ? draft.baseUrl.trim() || null : null,
        apiKey: draft.apiKey.trim(),
      };
      create.mutate({ data }, {
        onSuccess: () => { setFormOpen(false); setNotice("Proveedor agregado."); invalidate(); },
        onError: (e) => setError(apiError(e)),
      });
    }
  };
  const deleteProvider = (provider: RouterProvider) => {
    if (!window.confirm(`¿Eliminar el proveedor "${provider.name}"?`)) return;
    remove.mutate({ providerId: provider.id }, {
      onSuccess: () => { setNotice("Proveedor eliminado."); invalidate(); },
      onError: (e) => setError(apiError(e)),
    });
  };
  const testProvider = (provider: RouterProvider) => {
    if (!window.confirm("Se enviará una consulta de prueba al proveedor. Puede generar consumo o cargos en tu cuenta del proveedor. ¿Querés continuar?")) return;
    setNotice(null); setError(null);
    test.mutate({ providerId: provider.id }, {
      onSuccess: (result) => { if (result.ok) setNotice(`La conexión de ${provider.name} funciona (${result.latencyMs ?? "—"} ms).`); else setError(result.message); invalidate(); },
      onError: (e) => setError(apiError(e)),
    });
  };

  return (
    <div className="builder-provider-settings-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="builder-provider-settings" role="dialog" aria-modal="true" aria-labelledby="router-settings-title">
        <header className="builder-provider-settings-header">
          <div><span className="builder-provider-settings-eyebrow">AJUSTES DEL GENERADOR</span><h2 id="router-settings-title">Proveedores de CoreX</h2></div>
          <button type="button" onClick={onClose} aria-label="Cerrar configuración" data-testid="button-close-router-settings"><X size={18} /></button>
        </header>
        <div className="builder-provider-settings-content">
          <div className="builder-provider-list-heading">
            <div><h3>Router IA</h3><p>Administrá los proveedores que CoreX puede usar para generar respuestas.</p></div>
            <button type="button" className="builder-provider-refresh" onClick={() => void providers.refetch()} disabled={providers.isFetching} aria-label="Actualizar proveedores" data-testid="button-refresh-providers">
              {providers.isFetching ? <LoaderCircle size={15} className="builder-spin" /> : <RefreshCw size={15} />}
            </button>
          </div>
          {error && <p className="builder-provider-settings-error" role="alert" data-testid="status-provider-error"><AlertCircle size={15} />{error}</p>}
          {notice && <p className="builder-provider-test-result is-passed" role="status" data-testid="status-provider-notice"><Check size={14} />{notice}</p>}
          {providers.isLoading && <p className="builder-provider-settings-note" role="status" data-testid="status-providers-loading"><LoaderCircle size={15} className="builder-spin" /> Cargando proveedores…</p>}
          {providers.isError && !providers.isLoading && <p className="builder-provider-settings-error" role="alert" data-testid="status-providers-load-error"><AlertCircle size={15} />{apiError(providers.error)}</p>}
          {!providers.isLoading && !providers.isError && providers.data?.length === 0 && (
            <div className="builder-provider-card" data-testid="empty-providers"><CircleHelp size={18} /><strong>No hay proveedores configurados</strong><p>Agregá una clave para habilitar el Router IA.</p></div>
          )}
          {providers.data?.map((provider) => (
            <article className="builder-provider-card" key={provider.id} data-testid={`card-provider-${provider.id}`}>
              <div className="builder-provider-card-heading">
                <div><h4>{provider.name}</h4><p>{provider.kind} · {provider.model} · clave configurada</p></div>
                <span className={`builder-provider-status ${provider.isActive ? "" : "is-suspended"}`} data-testid={`status-provider-${provider.id}`}>{provider.isActive ? (provider.isDefault ? "Predeterminado" : "Activo") : "Inactivo"}</span>
              </div>
              <div className="builder-provider-capabilities">{provider.capabilities.map((capability) => <span key={capability}>{labels[capability] ?? capability}</span>)}</div>
              <p className="builder-provider-settings-note">Prioridad {provider.priority} · {providerHealthLabel(provider)}{provider.lastTestAt ? ` · Probado ${new Date(provider.lastTestAt).toLocaleString("es-AR")}` : ""}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                <button type="button" className="builder-provider-test-button" onClick={() => testProvider(provider)} disabled={test.isPending} data-testid={`button-test-provider-${provider.id}`}><Check size={14} />{test.isPending ? "Probando…" : "Probar"}</button>
                <button type="button" className="builder-provider-test-button" onClick={() => beginEdit(provider)} data-testid={`button-edit-provider-${provider.id}`}><Pencil size={14} />Editar</button>
                <button type="button" className="builder-provider-test-button" onClick={() => deleteProvider(provider)} disabled={busy} data-testid={`button-delete-provider-${provider.id}`}><Trash2 size={14} />Eliminar</button>
              </div>
            </article>
          ))}
          <button type="button" className="builder-provider-test-all" onClick={beginAdd} data-testid="button-add-provider"><Plus size={15} /> Agregar proveedor</button>
          <p className="builder-provider-settings-note"><CircleHelp size={14} /> Las claves se cifran del lado del servidor y nunca se devuelven en las respuestas. Al editar, dejá la clave en blanco para conservar la existente. La prueba de conexión puede generar consumo en el proveedor.</p>
          {formOpen && <Form {...form}>
            <form className="builder-provider-card" onSubmit={form.handleSubmit(submit)} aria-label={editing ? "Editar proveedor" : "Agregar proveedor"} data-testid="form-provider">
              <div className="builder-provider-card-heading"><h4>{editing ? "Editar proveedor" : "Agregar proveedor"}</h4><button type="button" onClick={() => setFormOpen(false)} aria-label="Cancelar" data-testid="button-cancel-provider"><X size={16} /></button></div>
              <FormField control={form.control} name="name" rules={{ required: "Completá el nombre." }} render={({ field }) => (
                <FormItem><FormLabel>Nombre</FormLabel><FormControl><input {...field} required data-testid="input-provider-name" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="kind" render={({ field }) => (
                <FormItem><FormLabel>Tipo</FormLabel><FormControl><select {...field} disabled={Boolean(editing)} data-testid="select-provider-kind">{kinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="model" rules={{ required: "Completá el modelo." }} render={({ field }) => (
                <FormItem><FormLabel>Modelo</FormLabel><FormControl><input {...field} required data-testid="input-provider-model" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="apiKey" rules={!editing ? { required: "Completá la clave API." } : undefined} render={({ field }) => (
                <FormItem><FormLabel>Clave API {editing ? "(opcional para reemplazarla)" : ""}</FormLabel><FormControl><input {...field} required={!editing} type="password" autoComplete="new-password" data-testid="input-provider-api-key" /></FormControl><FormMessage /></FormItem>
              )} />
              {draft.kind === "openai-compatible" && <FormField control={form.control} name="baseUrl" rules={{ required: "Completá la URL pública HTTPS del proveedor." }} render={({ field }) => (
                <FormItem><FormLabel>URL base</FormLabel><FormControl><input {...field} required type="url" data-testid="input-provider-base-url" /></FormControl><FormMessage /></FormItem>
              )} />}
              <FormField control={form.control} name="priority" rules={{ required: "Indicá la prioridad.", min: { value: 0, message: "La prioridad mínima es 0." }, max: { value: 1000, message: "La prioridad máxima es 1000." } }} render={({ field }) => (
                <FormItem><FormLabel>Prioridad</FormLabel><FormControl><input {...field} type="number" min="0" max="1000" data-testid="input-provider-priority" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="capabilities" render={({ field }) => (
                <FormItem><fieldset><legend>Capacidades</legend>{capabilities.map((capability) => <label key={capability}><input type="checkbox" name={field.name} ref={field.ref} checked={field.value.includes(capability)} onBlur={field.onBlur} onChange={(event) => field.onChange(event.target.checked ? [...field.value, capability] : field.value.filter((item) => item !== capability))} data-testid={`checkbox-provider-capability-${capability}`} />{labels[capability]}</label>)}<FormMessage /></fieldset></FormItem>
              )} />
              <FormField control={form.control} name="isDefault" render={({ field }) => (
                <FormItem><label><FormControl><input type="checkbox" name={field.name} ref={field.ref} checked={field.value} onBlur={field.onBlur} onChange={(event) => field.onChange(event.target.checked)} data-testid="checkbox-provider-default" /></FormControl> Usar como predeterminado</label><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="isActive" render={({ field }) => (
                <FormItem><label><FormControl><input type="checkbox" name={field.name} ref={field.ref} checked={field.value} onBlur={field.onBlur} onChange={(event) => field.onChange(event.target.checked)} data-testid="checkbox-provider-active" /></FormControl> Activo</label><FormMessage /></FormItem>
              )} />
              <button type="submit" className="builder-provider-test-all" disabled={busy} data-testid="button-save-provider">{busy ? "Guardando…" : editing ? "Guardar cambios" : "Agregar proveedor"}</button>
            </form>
          </Form>}
        </div>
      </section>
    </div>
  );
}