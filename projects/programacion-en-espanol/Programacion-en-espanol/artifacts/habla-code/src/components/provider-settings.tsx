import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, CircleHelp, LoaderCircle, RefreshCw, X } from "lucide-react";
import {
  listBuilderProviders,
  testBuilderProviders,
} from "@workspace/api-client-react";

type ProviderPreference = string;
type ProviderSnapshot = Awaited<ReturnType<typeof listBuilderProviders>>;
type ProviderInfo = ProviderSnapshot["providers"][number];
type TestResult = Awaited<ReturnType<typeof testBuilderProviders>>["results"][number];

type ProviderSettingsProps = {
  open: boolean;
  preference: ProviderPreference;
  onPreferenceChange: (preference: ProviderPreference) => void;
  onClose: () => void;
};

const capabilityLabels: Record<ProviderInfo["capabilities"][number], string> = {
  text: "Texto",
  json: "JSON",
  planning: "Planificación",
  vision: "Imágenes",
};

function formatTime(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function resultLabel(result: TestResult): string {
  if (result.status === "passed") return "Test correcto";
  if (result.status === "missing-key") return "Falta configurar la clave";
  if (result.status === "suspended") return "Proveedor suspendido";
  return "El test falló";
}

export function ProviderSettings({
  open,
  preference,
  onPreferenceChange,
  onClose,
}: ProviderSettingsProps) {
  const [snapshot, setSnapshot] = useState<ProviderSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setSnapshot(await listBuilderProviders());
    } catch {
      setLoadError("No pude leer la configuración. Revisá que el servidor esté disponible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const runTest = async (providerId: string) => {
    setTestingId(providerId);
    setLoadError(null);
    try {
      const result = await testBuilderProviders({
        providerId,
      });
      setTestResults((current) => ({
        ...current,
        ...Object.fromEntries(result.results.map((item) => [item.providerId, item])),
      }));
      await refresh();
    } catch {
      setLoadError("No pude completar el test. Revisá la conexión e intentá de nuevo.");
    } finally {
      setTestingId(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="builder-provider-settings-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="builder-provider-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="builder-provider-settings-title"
      >
        <header className="builder-provider-settings-header">
          <div>
            <span className="builder-provider-settings-eyebrow">AJUSTES DEL GENERADOR</span>
            <h2 id="builder-provider-settings-title">Configuración</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar configuración">
            <X size={18} />
          </button>
        </header>

        <div className="builder-provider-settings-content">
          <section className="builder-provider-preference">
            <label htmlFor="builder-provider-preference">Proveedor para las tareas</label>
            <select
              id="builder-provider-preference"
              value={preference}
              onChange={(event) => onPreferenceChange(event.target.value as ProviderPreference)}
            >
              <option value="auto">Automático · recomendado</option>
              {snapshot?.providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  Preferir {provider.name}{provider.configured ? "" : " (sin configurar)"}
                </option>
              ))}
            </select>
            <p>En automático, cada tarea se asigna según las capacidades y la confiabilidad de cada proveedor.</p>
          </section>

          <div className="builder-provider-list-heading">
            <div>
              <h3>Proveedores</h3>
              <p>Las claves se leen desde Replit Secrets; nunca se muestran en esta pantalla.</p>
            </div>
            <button
              type="button"
              className="builder-provider-refresh"
              onClick={() => void refresh()}
              disabled={loading || testingId !== null}
              aria-label="Actualizar estado"
              title="Actualizar estado"
            >
              {loading ? <LoaderCircle size={15} className="builder-spin" /> : <RefreshCw size={15} />}
            </button>
          </div>

          {loadError && <p className="builder-provider-settings-error" role="alert"><AlertCircle size={15} />{loadError}</p>}

          {snapshot?.providers.map((provider: ProviderInfo) => {
            const result = testResults[provider.id];
            const isSuspended = Boolean(provider.suspendedUntil);
            return (
              <article className="builder-provider-card" key={provider.id}>
                <div className="builder-provider-card-heading">
                  <div>
                    <h4>{provider.name}</h4>
                    <p>{provider.model}</p>
                  </div>
                  <span className={`builder-provider-status ${!provider.configured ? "is-missing" : isSuspended ? "is-suspended" : "is-ready"}`}>
                    {!provider.configured ? "Sin configurar" : isSuspended ? "Suspendido" : "Disponible"}
                  </span>
                </div>

                <div className="builder-provider-capabilities">
                  {provider.capabilities.map((capability) => (
                    <span key={capability}>{capabilityLabels[capability]}</span>
                  ))}
                </div>

                <div className="builder-provider-reliability">
                  <div className="builder-provider-reliability-copy">
                    <span>Confiabilidad <strong>{provider.reliability}/100</strong></span>
                    <small>{provider.successes} correctos · {provider.failures} fallidos</small>
                  </div>
                  <div
                    className="builder-provider-reliability-track"
                    role="meter"
                    aria-label={`Confiabilidad de ${provider.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={provider.reliability}
                  >
                    <span style={{ width: `${provider.reliability}%` }} />
                  </div>
                </div>

                {!provider.configured && (
                  <p className="builder-provider-key-hint">
                    <CircleHelp size={14} />
                    Agregá <code>{provider.secretName}</code> en Replit Secrets para activarlo.
                  </p>
                )}
                {isSuspended && provider.suspendedUntil && (
                  <p className="builder-provider-suspension">
                    En pausa hasta las {formatTime(provider.suspendedUntil)} tras un error. Un test manual puede reactivarlo.
                  </p>
                )}
                {provider.lastError && <p className="builder-provider-last-error">{provider.lastError}</p>}
                {provider.lastTestAt && <p className="builder-provider-last-test">Último test: {formatTime(provider.lastTestAt)}</p>}

                {result && (
                  <div className={`builder-provider-test-result ${result.status === "passed" ? "is-passed" : "is-failed"}`} role="status">
                    {result.status === "passed" ? <Check size={14} /> : <AlertCircle size={14} />}
                    <span>
                      <strong>{resultLabel(result)}</strong>
                      {result.status === "passed"
                        ? ` · ${result.testedCapabilities.map((capability) => capabilityLabels[capability]).join(", ")} · ${result.latencyMs} ms`
                        : result.error ? ` · ${result.error}` : ""}
                    </span>
                  </div>
                )}

                <button
                  type="button"
                  className="builder-provider-test-button"
                  onClick={() => void runTest(provider.id)}
                  disabled={testingId !== null}
                >
                  {testingId === provider.id ? <LoaderCircle size={14} className="builder-spin" /> : null}
                  Probar proveedor
                </button>
              </article>
            );
          })}

          <button
            type="button"
            className="builder-provider-test-all"
            onClick={() => void runTest("all")}
            disabled={testingId !== null || !snapshot?.providers.length}
          >
            {testingId === "all" ? <LoaderCircle size={15} className="builder-spin" /> : null}
            Probar todos los proveedores
          </button>

          <p className="builder-provider-settings-note">
            Cada test hace solicitudes reales. Un resultado correcto suma 4 puntos; un error resta 20 y pausa ese proveedor durante 2 minutos.
            El historial se reinicia cuando se reinicia el servidor.
          </p>
          <details className="builder-provider-add-note">
            <summary>Agregar otro proveedor</summary>
            <p>
              Para sumar otro servicio compatible, agregá un descriptor en el registro del servidor: nombre, endpoint, modelo,
              nombre del secreto y capacidades. El selector y el menú lo incorporan automáticamente.
            </p>
          </details>
        </div>
      </section>
    </div>
  );
}