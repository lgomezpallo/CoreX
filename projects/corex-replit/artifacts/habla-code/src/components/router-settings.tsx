import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, CircleHelp, LoaderCircle, RefreshCw, X } from "lucide-react";
import {
  getRouterStatus,
  testRouterConnection,
} from "@workspace/api-client-react";

type RouterSnapshot = Awaited<ReturnType<typeof getRouterStatus>>;

function formatTime(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function RouterSettings({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<RouterSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setSnapshot(await getRouterStatus());
    } catch {
      setLoadError("No pude leer el estado. Revisá que el servidor esté disponible.");
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

  const runTest = async () => {
    setTesting(true);
    setLoadError(null);
    try {
      setSnapshot(await testRouterConnection({ task_type: "chat" }));
    } catch {
      setLoadError("No pude completar el test. Revisá la conexión e intentá de nuevo.");
    } finally {
      setTesting(false);
    }
  };

  if (!open) return null;

  const statusLabel = !snapshot?.configured
    ? "Sin configurar"
    : snapshot.connected
      ? "Conectado"
      : snapshot.lastTestAt
        ? "Sin conexión"
        : "Sin probar";
  const statusClass = !snapshot?.configured
    ? "is-missing"
    : snapshot.connected
      ? "is-ready"
      : "is-suspended";

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
        aria-labelledby="router-settings-title"
      >
        <header className="builder-provider-settings-header">
          <div>
            <span className="builder-provider-settings-eyebrow">AJUSTES DEL GENERADOR</span>
            <h2 id="router-settings-title">Configuración</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar configuración">
            <X size={18} />
          </button>
        </header>

        <div className="builder-provider-settings-content">
          <div className="builder-provider-list-heading">
            <div>
              <h3>Router IA</h3>
              <p>CoreX envía sus solicitudes al Router; este administra el modelo y el proveedor.</p>
            </div>
            <button
              type="button"
              className="builder-provider-refresh"
              onClick={() => void refresh()}
              disabled={loading || testing}
              aria-label="Actualizar estado"
              title="Actualizar estado"
            >
              {loading ? <LoaderCircle size={15} className="builder-spin" /> : <RefreshCw size={15} />}
            </button>
          </div>

          {loadError && (
            <p className="builder-provider-settings-error" role="alert">
              <AlertCircle size={15} />{loadError}
            </p>
          )}

          {snapshot && (
            <article className="builder-provider-card">
              <div className="builder-provider-card-heading">
                <div>
                  <h4>Estado de conexión</h4>
                  <p>La clave nunca se envía al navegador.</p>
                </div>
                <span className={`builder-provider-status ${statusClass}`}>{statusLabel}</span>
              </div>

              {!snapshot.configured && (
                <p className="builder-provider-key-hint">
                  <CircleHelp size={14} />
                  Configurá <code>ROUTER_APP_KEY</code> en el entorno del servidor.
                </p>
              )}

              {snapshot.message && snapshot.configured && (
                <p className="builder-provider-last-error" role="status">{snapshot.message}</p>
              )}

              {snapshot.lastTestAt && (
                <p className="builder-provider-last-test">
                  Último test: {formatTime(snapshot.lastTestAt)}
                  {snapshot.lastLatencyMs !== null ? ` · ${snapshot.lastLatencyMs} ms` : ""}
                </p>
              )}

              {snapshot.connected && (
                <div className="builder-provider-test-result is-passed" role="status">
                  <Check size={14} />
                  <span><strong>La conexión funciona.</strong></span>
                </div>
              )}

              <button
                type="button"
                className="builder-provider-test-button"
                onClick={() => void runTest()}
                disabled={testing || loading}
              >
                {testing ? <LoaderCircle size={14} className="builder-spin" /> : null}
                Probar conexión
              </button>
            </article>
          )}

          <p className="builder-provider-settings-note">
            <CircleHelp size={14} />
            <span>
              <code>ROUTER_URL</code> es opcional. <code>ROUTER_APP_ID</code> también es opcional
              y permanece en el servidor; no se transmite hasta confirmar el campo que acepta Router IA.
            </span>
          </p>
        </div>
      </section>
    </div>
  );
}