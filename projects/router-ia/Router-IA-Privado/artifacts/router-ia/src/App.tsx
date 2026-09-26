import { useEffect, useRef, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  ClerkProvider,
  Show,
  SignIn,
  SignUp,
  useAuth,
  useClerk,
  useUser,
} from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { esES } from '@clerk/localizations';
import { shadcn } from '@clerk/themes';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  KeyRound,
  LayoutDashboard,
  Link2,
  Loader2,
  LockKeyhole,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Network,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Trash2,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import {
  getListRouterAppTokensQueryKey,
  getGetRouterSummaryQueryKey,
  getGetRouterTokenStatusQueryKey,
  getListProvidersQueryKey,
  useCreateRouterAppToken,
  useCreateProvider,
  useCreateRouterToken,
  useDeleteProvider,
  useGetRouterStatus,
  useGetRouterSummary,
  useGetRouterTokenStatus,
  useListRouterAppTokens,
  useListProviders,
  useRevokeRouterAppToken,
  useRevokeRouterToken,
  useSendRouterChat,
  useTestProvider,
  useUpdateProvider,
  type Provider,
  type ProviderInput,
  type ProviderInputKind,
  type ProviderUpdate,
  type RouterChatInput,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { ModelAutocomplete } from '@/components/model-autocomplete';
import NotFound from '@/pages/not-found';
import '@/index.css';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#15796B',
    colorForeground: '#26343A',
    colorMutedForeground: '#68767A',
    colorDanger: '#B5473E',
    colorBackground: '#FBF8F1',
    colorInput: '#F1ECE1',
    colorInputForeground: '#26343A',
    colorNeutral: '#D7D0C2',
    fontFamily: 'Bricolage Grotesque, sans-serif',
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fbf8f1] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#d7d0c2]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#26343a] font-semibold',
    headerSubtitle: 'text-[#68767a]',
    socialButtonsBlockButtonText: 'text-[#26343a]',
    formFieldLabel: 'text-[#26343a]',
    footerActionLink: 'text-[#15796b] font-semibold',
    footerActionText: 'text-[#68767a]',
    dividerText: 'text-[#68767a]',
    identityPreviewEditButton: 'text-[#15796b]',
    formFieldSuccessText: 'text-[#15796b]',
    alertText: 'text-[#26343a]',
    logoBox: 'h-10',
    logoImage: 'h-10 w-10',
    socialButtonsBlockButton: 'border-[#d7d0c2] bg-[#f1ece1] hover:bg-[#e8e1d3]',
    formButtonPrimary: 'bg-[#15796b] hover:bg-[#11675c] text-[#fbf8f1] shadow-none',
    formFieldInput: 'border-[#d7d0c2] bg-[#f1ece1] text-[#26343a]',
    footerAction: 'border-t border-[#d7d0c2]',
    dividerLine: 'bg-[#d7d0c2]',
    alert: 'border-[#e4b64b] bg-[#fff4d8]',
    otpCodeFieldInput: 'border-[#d7d0c2] bg-[#f1ece1] text-[#26343a]',
    formFieldRow: 'gap-1',
    main: 'gap-5',
  },
};

function IconMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground ${small ? 'h-8 w-8' : 'h-10 w-10'}`}>
      <Network size={small ? 17 : 20} strokeWidth={2.2} />
    </span>
  );
}

function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'outline' | 'danger' }) {
  const styles = {
    primary: 'bg-primary text-primary-foreground hover:brightness-95',
    quiet: 'bg-muted text-foreground hover:bg-border',
    outline: 'border border-border bg-card text-foreground hover:bg-muted',
    danger: 'border border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10',
  };
  return (
    <button className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: Provider['status'] }) {
  const connected = status === 'connected';
  const error = status === 'error';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[.12em] ${connected ? 'bg-primary/10 text-primary' : error ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-primary' : error ? 'bg-destructive' : 'bg-muted-foreground/50'}`} />
      {connected ? 'conectado' : error ? 'atención' : 'sin probar'}
    </span>
  );
}

function PageLoading() {
  return (
    <div className="space-y-5 animate-pulse" aria-label="Cargando">
      <div className="h-4 w-24 rounded bg-muted" />
      <div className="h-12 w-72 rounded bg-muted" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="h-36 rounded-xl bg-muted" /><div className="h-36 rounded-xl bg-muted" /><div className="h-36 rounded-xl bg-muted" />
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, description, action }: { icon: typeof Network; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center border border-dashed border-border bg-card/60 px-6 py-16 text-center">
      <span className="mb-4 rounded-xl bg-muted p-3 text-primary"><Icon size={22} /></span>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const nav = [
    { href: '/dashboard', label: 'Resumen', icon: LayoutDashboard },
    { href: '/providers', label: 'Proveedores', icon: Server },
    { href: '/playground', label: 'Pruebas', icon: MessageSquare },
    { href: '/applications', label: 'Aplicaciones', icon: Code2 },
    { href: '/api-access', label: 'Acceso API', icon: KeyRound },
  ];
  return (
    <div className="flex min-h-[100dvh] bg-background">
      <aside className="hidden w-[246px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-20 items-center gap-3 border-b border-sidebar-border px-6">
          <IconMark small />
          <div><div className="font-semibold tracking-tight">Router IA</div><div className="font-mono text-[9px] uppercase tracking-[.2em] text-sidebar-foreground/50">sala de control privada</div></div>
        </div>
        <div className="px-4 pt-8">
          <p className="px-3 pb-3 font-mono text-[10px] uppercase tracking-[.2em] text-sidebar-foreground/40">Espacio de trabajo</p>
          <nav className="space-y-1">
            {nav.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase().replace(' ', '-')}`} className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition ${location === href ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`}>
                <Icon size={17} /> {label}
                {href === '/api-access' && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary" />}
              </Link>
            ))}
          </nav>
        </div>
        <div className="mt-auto space-y-5 p-4">
          <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck size={15} className="text-sidebar-primary" /> Privado por defecto</div>
            <p className="mt-2 text-xs leading-5 text-sidebar-foreground/50">Las claves viven en el servidor. Tus apps solo ven un endpoint estable.</p>
          </div>
          <div className="flex items-center gap-3 border-t border-sidebar-border pt-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-primary font-semibold text-xs text-sidebar-primary-foreground">{(user?.firstName?.[0] || user?.emailAddresses[0]?.emailAddress?.[0] || 'R').toUpperCase()}</span>
            <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{user?.firstName || 'Propietario del router'}</div><div className="truncate text-[10px] text-sidebar-foreground/45">{user?.emailAddresses[0]?.emailAddress}</div></div>
            <button type="button" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out" className="text-sidebar-foreground/50 hover:text-sidebar-foreground" aria-label="Cerrar sesión"><LogOut size={15} /></button>
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border/80 bg-background/90 px-5 backdrop-blur md:px-10">
          <div className="flex items-center gap-3 md:hidden"><IconMark small /><span className="font-semibold">Router IA</span></div>
          <div className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground md:flex"><span className="h-2 w-2 rounded-full bg-primary" /> Capa de routing operativa</div>
          <div className="ml-auto flex items-center gap-2"><span className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">sesión local</span><span className="h-2 w-2 rounded-full bg-secondary" /></div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-card px-4 py-2 md:hidden">
          {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`link-mobile-nav-${label.toLowerCase().replace(' ', '-')}`} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${location === href ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}><Icon size={14} />{label}</Link>)}
        </nav>
        <main className="router-grid min-h-[calc(100dvh-4rem)] px-5 py-8 md:px-10 md:py-12">{children}</main>
      </div>
    </div>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="flex min-h-[100dvh] items-center justify-center bg-background"><PageLoading /></div>;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  return <AppShell>{children}</AppShell>;
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="mb-9 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-primary"><span className="h-px w-6 bg-primary" />{eyebrow}</div><h1 className="text-4xl font-semibold tracking-[-.04em] text-balance md:text-5xl">{title}</h1><p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p></div>{action}</div>;
}

function StatCard({ label, value, note, icon: Icon, tone = 'plain' }: { label: string; value: ReactNode; note: string; icon: typeof Activity; tone?: 'plain' | 'green' | 'orange' }) {
  return <div className={`border border-border bg-card p-5 ${tone === 'green' ? 'border-primary/30' : tone === 'orange' ? 'border-secondary/40' : ''}`}><div className="flex items-start justify-between"><span className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">{label}</span><Icon size={17} className={tone === 'green' ? 'text-primary' : tone === 'orange' ? 'text-secondary' : 'text-muted-foreground'} /></div><div className="mt-7 text-3xl font-semibold tracking-[-.04em]">{value}</div><div className="mt-2 text-xs text-muted-foreground">{note}</div></div>;
}

function DashboardPage() {
  const summaryQuery = useGetRouterSummary();
  const providersQuery = useListProviders();
  const statusQuery = useGetRouterStatus();
  const summary = summaryQuery.data;
  const routerStatus = statusQuery.data;
  const providers = providersQuery.data || [];
  if (summaryQuery.isLoading || providersQuery.isLoading || statusQuery.isLoading) return <PageLoading />;
  if (summaryQuery.isError || providersQuery.isError || statusQuery.isError) return <ErrorState onRetry={() => { summaryQuery.refetch(); providersQuery.refetch(); statusQuery.refetch(); }} />;
  return <div className="mx-auto max-w-6xl animate-rise">
    <PageHeader eyebrow="Resumen / 01" title="Tu capa de routing, de un vistazo." description="Una sala de control privada para cada proveedor de modelos que usan tus apps. Agrega las credenciales una vez y enruta todo por una API estable." action={<Link href="/providers" data-testid="link-dashboard-add-provider" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:brightness-95"><Plus size={16} /> Agregar proveedor</Link>} />
    <div className="grid gap-4 md:grid-cols-3">
      <StatCard label="Proveedores configurados" value={summary?.providerCount ?? 0} note={summary?.providerCount ? 'Listos para que tus apps los seleccionen' : 'Agrega un proveedor para comenzar'} icon={Server} tone="green" />
      <StatCard label="Ruta predeterminada" value={summary?.defaultProvider?.name || 'Sin definir'} note={summary?.defaultProvider ? `${summary.defaultProvider.model} · ${summary.defaultProvider.kind}` : 'Elige un proveedor predeterminado'} icon={Zap} tone="orange" />
      <StatCard label="Token personal de API" value={summary?.hasToken ? 'Activo' : 'No emitido'} note={summary?.hasToken ? 'Tus apps ya pueden conectarse' : 'Emítelo cuando estés listo'} icon={KeyRound} tone={summary?.hasToken ? 'green' : 'plain'} />
    </div>
    <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Peticiones · 24 h" value={routerStatus?.requests24h ?? 0} note="Solicitudes únicas recibidas" icon={Activity} />
      <StatCard label="Failovers · 24 h" value={routerStatus?.fallbacks24h ?? 0} note="Solicitudes que probaron otra ruta" icon={RefreshCw} tone={routerStatus?.fallbacks24h ? 'orange' : 'plain'} />
      <StatCard label="Éxito reciente" value={routerStatus?.successRatePercent === null || routerStatus?.successRatePercent === undefined ? '—' : `${routerStatus.successRatePercent}%`} note={routerStatus?.averageLatencyMs == null ? 'Sin datos de latencia todavía' : `Latencia media ${routerStatus.averageLatencyMs} ms`} icon={CheckCircle2} tone={routerStatus?.successRatePercent != null && routerStatus.successRatePercent >= 95 ? 'green' : 'plain'} />
      <StatCard label="Estado del router" value={routerStatus?.status === 'not_configured' ? 'Sin configurar' : routerStatus?.status === 'available' ? 'Disponible' : routerStatus?.status === 'degraded' ? 'Degradado' : 'No disponible'} note={`${routerStatus?.availableProviderCount ?? 0} de ${routerStatus?.providerCount ?? 0} rutas disponibles`} icon={Network} tone={routerStatus?.status === 'available' ? 'green' : routerStatus?.status === 'degraded' ? 'orange' : 'plain'} />
    </div>
    <div className="mt-6 grid gap-6 lg:grid-cols-[1.35fr_.65fr]">
      <section className="border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-semibold">Red de proveedores</h2><p className="mt-1 text-xs text-muted-foreground">Las rutas disponibles para tu API privada.</p></div><Link href="/providers" data-testid="link-dashboard-providers" className="font-mono text-[10px] uppercase tracking-[.14em] text-primary hover:underline">Administrar todos <ArrowRight size={13} className="ml-1 inline" /></Link></div>
        {providers.length === 0 ? <EmptyState icon={Server} title="No hay rutas configuradas" description="Conecta tu primer proveedor de modelos y conviértelo en la ruta predeterminada para cada app nueva." action={<Link href="/providers" data-testid="link-empty-providers" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"><Plus size={15} /> Conectar proveedor</Link>} /> : <div className="divide-y divide-border">{providers.slice(0, 4).map(provider => <ProviderRow key={provider.id} provider={provider} />)}</div>}
      </section>
      <section className="relative overflow-hidden border border-sidebar-border bg-sidebar p-6 text-sidebar-foreground">
        <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full border border-sidebar-primary/20" /><div className="absolute -right-5 -top-5 h-24 w-24 rounded-full border border-sidebar-primary/20" />
        <div className="relative"><div className="mb-9 flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[.18em] text-sidebar-foreground/50">Revisión de señal</span><Activity size={18} className="text-sidebar-primary" /></div><div className="font-mono text-xs uppercase tracking-[.14em] text-sidebar-primary">API estable / v1</div><h2 className="mt-3 text-2xl font-semibold tracking-[-.03em]">A tus apps no debería importar quién responde.</h2><p className="mt-3 text-sm leading-6 text-sidebar-foreground/55">Los cambios de proveedor se quedan aquí. El código de integración sigue simple.</p><div className="signal-line mt-8 h-px w-full" /><Link href="/api-access" data-testid="link-dashboard-api-access" className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-sidebar-primary hover:underline">Ver detalles de conexión <ArrowRight size={15} /></Link></div>
      </section>
    </div>
    <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
      <section className="border border-border bg-card">
        <div className="border-b border-border px-5 py-4"><h2 className="font-semibold">Salud de proveedores</h2><p className="mt-1 text-xs text-muted-foreground">Solicitudes y respuesta de cada ruta durante las últimas 24 horas.</p></div>
        {routerStatus?.providers.length ? <div className="divide-y divide-border">{routerStatus.providers.map(provider => <div key={provider.providerId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0"><div className="truncate text-sm font-semibold">{provider.name}</div><div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{provider.model}</div></div>
          <div className="flex items-center gap-4 text-right">
            <div><div className="font-mono text-xs">{provider.requestCount}</div><div className="mt-1 text-[9px] uppercase tracking-wider text-muted-foreground">peticiones</div></div>
            <div><div className="font-mono text-xs">{provider.averageLatencyMs == null ? '—' : `${provider.averageLatencyMs} ms`}</div><div className="mt-1 text-[9px] uppercase tracking-wider text-muted-foreground">media</div></div>
            <span className={`rounded-full px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider ${!provider.isActive ? 'bg-muted text-muted-foreground' : provider.healthStatus === 'available' ? 'bg-primary/10 text-primary' : provider.healthStatus === 'degraded' ? 'bg-secondary/15 text-secondary-foreground' : 'bg-destructive/10 text-destructive'}`}>{!provider.isActive ? 'inactivo' : provider.healthStatus === 'available' ? 'disponible' : provider.healthStatus === 'degraded' ? 'degradado' : 'no disponible'}</span>
          </div>
        </div>)}</div> : <div className="px-5 py-8 text-sm text-muted-foreground">Agrega un proveedor para ver su salud y actividad.</div>}
      </section>
      <section className="border border-border bg-card">
        <div className="border-b border-border px-5 py-4"><h2 className="font-semibold">Actividad reciente</h2><p className="mt-1 text-xs text-muted-foreground">Último intento registrado, sin guardar prompts.</p></div>
        {routerStatus?.recentExecution ? <div className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold">{routerStatus.recentExecution.provider}</div><div className="mt-1 font-mono text-[10px] text-muted-foreground">{routerStatus.recentExecution.model}</div></div><span className={`rounded-full px-2.5 py-1 font-mono text-[9px] uppercase ${routerStatus.recentExecution.success ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>{routerStatus.recentExecution.success ? 'correcta' : 'fallida'}</span></div>
          <div className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-xs"><div><div className="text-muted-foreground">Aplicación</div><div className="mt-1 font-medium">{routerStatus.recentExecution.applicationName}</div></div><div><div className="text-muted-foreground">Intentos</div><div className="mt-1 font-medium">{routerStatus.recentExecution.attemptCount}</div></div><div className="col-span-2 text-[10px] text-muted-foreground">{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(routerStatus.recentExecution.createdAt))}</div></div>
        </div> : <div className="px-5 py-8 text-sm text-muted-foreground">Todavía no hay solicitudes registradas.</div>}
      </section>
    </div>
    <section className="mt-6 border border-border bg-card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="rounded-lg bg-primary/10 p-2 text-primary"><LockKeyhole size={17} /></span><div><h3 className="text-sm font-semibold">Los secretos nunca salen del servidor</h3><p className="mt-1 text-xs text-muted-foreground">Router IA solo devuelve vistas enmascaradas y resultados de prueba a este navegador.</p></div></div><Link href="/playground" data-testid="link-dashboard-playground" className="inline-flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-xs font-semibold hover:bg-muted">Probar el área de pruebas <ArrowRight size={14} /></Link></div></section>
  </div>;
}

function ProviderRow({ provider }: { provider: Provider }) {
  return <div className="flex flex-wrap items-center gap-4 px-5 py-4"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted font-mono text-xs font-semibold text-primary">{provider.kind === 'openai-compatible' ? 'OC' : provider.kind.slice(0, 2).toUpperCase()}</div><div className="min-w-[140px] flex-1"><div className="flex items-center gap-2 text-sm font-semibold">{provider.name}{provider.isDefault && <span className="rounded bg-secondary/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-secondary-foreground">predeterminada</span>}</div><div className="mt-1 font-mono text-[10px] text-muted-foreground">{provider.model} · {provider.apiKeyPreview}</div></div><StatusPill status={provider.status} /><div className="font-mono text-[10px] uppercase tracking-[.1em] text-muted-foreground">{provider.kind}</div></div>;
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return <div className="flex min-h-[400px] items-center justify-center"><div className="max-w-sm text-center"><span className="inline-flex rounded-xl bg-destructive/10 p-3 text-destructive"><TriangleAlert size={22} /></span><h2 className="mt-4 text-xl font-semibold">La sala de control está fuera de línea</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">No pudimos cargar tus datos de routing. Puede que el servidor esté haciendo una pausa breve.</p><Button variant="outline" className="mt-5" onClick={onRetry} data-testid="button-retry"><RefreshCw size={15} /> Intentar de nuevo</Button></div></div>;
}

type ProviderFormValues = { name: string; kind: ProviderInputKind; apiKey: string; model: string; baseUrl: string; isDefault: boolean };
const emptyProvider: ProviderFormValues = { name: '', kind: 'openai', apiKey: '', model: '', baseUrl: '', isDefault: false };

function ProviderForm({ provider, onClose }: { provider?: Provider; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<ProviderFormValues>(provider ? { name: provider.name, kind: provider.kind, apiKey: '', model: provider.model, baseUrl: provider.baseUrl || '', isDefault: provider.isDefault } : emptyProvider);
  const [error, setError] = useState('');
  const create = useCreateProvider();
  const update = useUpdateProvider();
  const isEdit = !!provider;
  const pending = create.isPending || update.isPending;
  const requiresCustomBaseUrl = values.kind === 'openai-compatible';
  const set = (key: keyof ProviderFormValues, value: string | boolean) => setValues(current => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!values.name.trim() || !values.model.trim() || (!isEdit && !values.apiKey.trim())) { setError(isEdit ? 'El nombre y el modelo son obligatorios.' : 'El nombre, el modelo y la clave API son obligatorios.'); return; }
    if (requiresCustomBaseUrl && !values.baseUrl.trim()) { setError('Para un proveedor compatible, ingresa la URL base HTTPS de su API.'); return; }
    if (isEdit) {
      const data: ProviderUpdate = { name: values.name.trim(), model: values.model.trim(), baseUrl: values.baseUrl.trim() || null, isDefault: values.isDefault };
      if (values.apiKey.trim()) data.apiKey = values.apiKey.trim();
      update.mutate({ id: provider.id, data }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetRouterSummaryQueryKey() }); onClose(); }, onError: () => setError('No se pudo actualizar este proveedor. Revisa los datos e inténtalo de nuevo.') });
    } else {
      const data: ProviderInput = { name: values.name.trim(), kind: values.kind, apiKey: values.apiKey.trim(), model: values.model.trim(), baseUrl: values.baseUrl.trim() || undefined, isDefault: values.isDefault };
      create.mutate({ data }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetRouterSummaryQueryKey() }); onClose(); }, onError: () => setError('No se pudo guardar este proveedor. La clave podría ser inválida o el servicio no estar disponible.') });
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 backdrop-blur-sm md:items-center md:p-6">
      <div className="max-h-[92dvh] w-full max-w-xl overflow-y-auto border border-border bg-background shadow-2xl">
        <div className="flex items-start justify-between border-b border-border px-6 py-5">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">
              {isEdit ? 'Editar ruta' : 'Nueva ruta'}
            </div>
            <h2 className="mt-2 text-2xl font-semibold">
              {isEdit ? `Ajustar ${provider.name}` : 'Conectar un proveedor'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isEdit
                ? 'Actualiza las preferencias de routing o reemplaza la credencial enmascarada.'
                : 'Las credenciales se cifran en el servidor y nunca vuelven a mostrarse.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="button-close-provider-form"
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-5 p-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="field-label">Nombre visible</span>
              <input
                data-testid="input-provider-name"
                value={values.name}
                onChange={(event) => set('name', event.target.value)}
                placeholder="ej. OpenAI de producción"
                className="field-input"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="field-label">Tipo de proveedor</span>
              <select
                data-testid="select-provider-kind"
                value={values.kind}
                disabled={isEdit}
                onChange={(event) =>
                  set('kind', event.target.value as ProviderInputKind)
                }
                className="field-input disabled:opacity-60"
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Google Gemini</option>
                <option value="openai-compatible">Compatible con OpenAI</option>
              </select>
            </label>
            <ModelAutocomplete
              providerKind={values.kind}
              value={values.model}
              onChange={(model) => set('model', model)}
            />
            <label className="block sm:col-span-2">
              <span className="field-label">
                Clave API{' '}
                {isEdit && (
                  <span className="font-normal text-muted-foreground">
                    (déjalo vacío para conservarla)
                  </span>
                )}
              </span>
              <input
                data-testid="input-provider-api-key"
                type="password"
                autoComplete="new-password"
                value={values.apiKey}
                onChange={(event) => set('apiKey', event.target.value)}
                placeholder={
                  isEdit ? '••••••••••••••••' : 'Pega la clave de tu proveedor'
                }
                className="field-input font-mono"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="field-label">
                URL base{' '}
                <span className="font-normal text-muted-foreground">
                  {requiresCustomBaseUrl ? '(obligatoria)' : '(no aplica)'}
                </span>
              </span>
              <input
                data-testid="input-provider-base-url"
                value={values.baseUrl}
                onChange={(event) => set('baseUrl', event.target.value)}
                placeholder="https://api.example.com/v1"
                className="field-input font-mono"
                disabled={!requiresCustomBaseUrl}
                required={requiresCustomBaseUrl}
              />
              <span className="mt-2 block text-xs leading-5 text-muted-foreground">
                {requiresCustomBaseUrl
                  ? 'Usa la dirección HTTPS pública que indica el servicio.'
                  : 'Los proveedores oficiales usan su propia dirección.'}
              </span>
            </label>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3.5">
            <input
              data-testid="input-provider-default"
              type="checkbox"
              checked={values.isDefault}
              onChange={(event) => set('isDefault', event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
            />
            <span>
              <span className="block text-sm font-semibold">
                Convertir en ruta predeterminada
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Las solicitudes sin un provider ID usarán esta conexión.
              </span>
            </span>
          </label>
          {error && (
            <div
              data-testid="status-provider-form-error"
              className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-xs leading-5 text-destructive"
            >
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-5">
            <Button
              type="button"
              variant="quiet"
              onClick={onClose}
              data-testid="button-cancel-provider"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={pending}
              data-testid="button-save-provider"
            >
              {pending && <Loader2 className="animate-spin" size={15} />}
              {isEdit ? 'Guardar cambios' : 'Conectar proveedor'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProvidersPage() {
  const queryClient = useQueryClient();
  const query = useListProviders();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | undefined>();
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string; latencyMs: number }>>({});
  const test = useTestProvider();
  const update = useUpdateProvider();
  const remove = useDeleteProvider();
  if (query.isLoading) return <PageLoading />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;
  const providers = query.data || [];
  const openCreate = () => { setEditing(undefined); setFormOpen(true); };
  const testProvider = (provider: Provider) => test.mutate({ id: provider.id }, { onSuccess: result => { setTestResults(current => ({ ...current, [provider.id]: result })); queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetRouterSummaryQueryKey() }); }, onError: () => setTestResults(current => ({ ...current, [provider.id]: { success: false, message: 'No se pudo completar la prueba de conexión.', latencyMs: 0 } })) });
  const makeDefault = (provider: Provider) => update.mutate({ id: provider.id, data: { isDefault: true } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetRouterSummaryQueryKey() }); } });
  const deleteOne = (provider: Provider) => { if (window.confirm(`¿Eliminar ${provider.name}? Esta acción no se puede deshacer.`)) remove.mutate({ id: provider.id }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetRouterSummaryQueryKey() }); } }); };
  return <div className="mx-auto max-w-6xl animate-rise"><PageHeader eyebrow="Proveedores / 02" title="Tu red de proveedores." description="Nombra las conexiones que tus apps pueden usar. Router IA mantiene la credencial fuera del cliente y solo muestra una vista segura." action={<Button onClick={openCreate} data-testid="button-add-provider"><Plus size={16} /> Agregar proveedor</Button>} />{providers.length === 0 ? <EmptyState icon={Server} title="Comienza con una ruta" description="Conecta OpenAI, Anthropic, Gemini o cualquier endpoint compatible con OpenAI. Puedes cambiar el predeterminado cuando quieras." action={<Button onClick={openCreate} data-testid="button-empty-add-provider"><Plus size={15} /> Conectar primer proveedor</Button>} /> : <div className="space-y-3">{providers.map((provider, index) => <ProviderCard key={provider.id} provider={provider} result={testResults[provider.id]} testing={test.isPending && test.variables?.id === provider.id} onTest={() => testProvider(provider)} onEdit={() => { setEditing(provider); setFormOpen(true); }} onDefault={() => makeDefault(provider)} onDelete={() => deleteOne(provider)} index={index} />)}</div>}<div className="mt-8 grid gap-4 md:grid-cols-3"><InfoTile icon={LockKeyhole} title="Enmascarado por diseño" body="Después de guardar, las claves se reemplazan por una vista corta. Nunca vuelven a este navegador." /><InfoTile icon={RefreshCw} title="Prueba antes de enrutar" body="La prueba de conexión envía un prompt corto y real para verificar la conexión, el modelo y la latencia." /><InfoTile icon={Settings2} title="Usa tu propio endpoint" body="Indica una URL base para un gateway propio o compatible con OpenAI." /></div>{formOpen && <ProviderForm provider={editing} onClose={() => setFormOpen(false)} />}</div>;
}

function ProviderCard({ provider, result, testing, onTest, onEdit, onDefault, onDelete, index }: { provider: Provider; result?: { success: boolean; message: string; latencyMs: number }; testing: boolean; onTest: () => void; onEdit: () => void; onDefault: () => void; onDelete: () => void; index: number }) {
  const [menu, setMenu] = useState(false);
  return <article className={`border border-border bg-card p-5 animate-rise delay-${Math.min(index + 1, 3)}`} data-testid={`card-provider-${provider.id}`}><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex min-w-0 items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted font-mono text-xs font-semibold text-primary">{provider.kind === 'openai-compatible' ? 'OC' : provider.kind.slice(0, 2).toUpperCase()}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-base font-semibold">{provider.name}</h2>{provider.isDefault && <span className="rounded bg-secondary/20 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-secondary-foreground">ruta predeterminada</span>}</div><div className="mt-1 flex flex-wrap gap-x-2 font-mono text-[10px] uppercase tracking-[.11em] text-muted-foreground"><span>{provider.kind}</span><span>·</span><span>{provider.model}</span></div></div></div><div className="relative flex items-center gap-2"><StatusPill status={provider.status} /><button type="button" onClick={() => setMenu(!menu)} data-testid={`button-provider-menu-${provider.id}`} className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><MoreHorizontal size={17} /></button>{menu && <div className="absolute right-0 top-10 z-10 w-44 border border-border bg-card p-1 shadow-lg"><button type="button" onClick={() => { onEdit(); setMenu(false); }} data-testid={`button-edit-provider-${provider.id}`} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs font-semibold hover:bg-muted"><Settings2 size={14} /> Editar detalles</button>{!provider.isDefault && <button type="button" onClick={() => { onDefault(); setMenu(false); }} data-testid={`button-default-provider-${provider.id}`} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs font-semibold hover:bg-muted"><CheckCircle2 size={14} /> Hacer predeterminada</button>}<button type="button" onClick={() => { onDelete(); setMenu(false); }} data-testid={`button-delete-provider-${provider.id}`} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs font-semibold text-destructive hover:bg-destructive/10"><Trash2 size={14} /> Eliminar</button></div>}</div></div><div className="mt-6 grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_auto] sm:items-end"><div className="grid grid-cols-2 gap-4 sm:grid-cols-3"><div><div className="field-label">Credencial</div><div className="mt-1 font-mono text-xs">{provider.apiKeyPreview}</div></div><div><div className="field-label">URL base</div><div className="mt-1 max-w-[220px] truncate font-mono text-xs text-muted-foreground">{provider.baseUrl || 'Predeterminada del proveedor'}</div></div><div><div className="field-label">Última prueba</div><div className="mt-1 text-xs text-muted-foreground">{provider.lastTestAt ? formatDate(provider.lastTestAt) : 'Todavía no'}</div></div></div><Button variant="outline" onClick={onTest} disabled={testing} data-testid={`button-test-provider-${provider.id}`} className="w-full sm:w-auto">{testing ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}{testing ? 'Probando...' : 'Probar conexión'}</Button></div>{result && <div data-testid={`status-test-result-${provider.id}`} className={`mt-4 flex items-start gap-2 rounded-lg p-3 text-xs ${result.success ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>{result.success ? <Check size={15} /> : <AlertCircle size={15} />}<span>{result.message} {result.latencyMs > 0 && <span className="font-mono opacity-75">({result.latencyMs} ms)</span>}</span></div>}</article>;
}

function InfoTile({ icon: Icon, title, body }: { icon: typeof LockKeyhole; title: string; body: string }) {
  return <div className="border border-border bg-card/70 p-4"><Icon size={17} className="text-primary" /><h3 className="mt-4 text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{body}</p></div>;
}

function PlaygroundPage() {
  const providersQuery = useListProviders();
  const chat = useSendRouterChat();
  const [prompt, setPrompt] = useState('');
  const [providerId, setProviderId] = useState('');
  const [taskType, setTaskType] = useState<NonNullable<RouterChatInput['taskType']>>('chat');
  const [temperature, setTemperature] = useState('0.7');
  const [maxTokens, setMaxTokens] = useState('1024');
  const [conversation, setConversation] = useState<{ role: 'user' | 'assistant'; content: string; meta?: string }[]>([]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!prompt.trim() || chat.isPending) return;
    const message = prompt.trim();
    setConversation(current => [...current, { role: 'user', content: message }]);
    setPrompt('');
    const data: RouterChatInput = {
      providerId: providerId || null,
      taskType,
      messages: [...conversation.map(item => ({ role: item.role, content: item.content })), { role: 'user', content: message }],
      temperature: Number(temperature),
      maxTokens: Number(maxTokens),
    };
    chat.mutate({ data }, { onSuccess: response => setConversation(current => [...current, { role: 'assistant', content: response.content, meta: `${response.provider} · ${response.model}` }]) });
  };
  const providers = providersQuery.data || [];
  return <div className="mx-auto max-w-6xl animate-rise">
    <PageHeader eyebrow="Playground / 03" title="Pregunta a través de tu ruta." description="Un espacio privado para probar el recorrido exacto que usarán tus aplicaciones. Sin credenciales en el navegador ni respuestas simuladas." action={<Link href="/api-access" data-testid="link-playground-api-access" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm font-semibold hover:bg-muted"><Code2 size={16} /> Acceso API</Link>} />
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <section className="flex min-h-[580px] flex-col border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><div className="flex items-center gap-2"><MessageSquare size={17} className="text-primary" /><span className="text-sm font-semibold">Conversación del router</span></div><span className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">{conversation.length ? `${conversation.length} mensajes` : 'listo'}</span></div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">{conversation.length === 0 ? <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center"><span className="mb-4 rounded-xl bg-primary/10 p-3 text-primary"><Sparkles size={22} /></span><h2 className="text-lg font-semibold">Envía una solicitud real</h2><p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">Elige un proveedor o deja que el router use tu ruta predeterminada. Las respuestas permanecen en esta sesión.</p></div> : conversation.map((item, index) => <div key={`${item.role}-${index}`} data-testid={`message-${item.role}-${index}`} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] ${item.role === 'user' ? 'bg-sidebar text-sidebar-foreground' : 'border border-border bg-background'} px-4 py-3 text-sm leading-6`}><p className="whitespace-pre-wrap">{item.content}</p>{item.meta && <div className="mt-3 border-t border-sidebar-border pt-2 font-mono text-[9px] uppercase tracking-[.13em] text-sidebar-foreground/45">{item.meta}</div>}</div></div>)}{chat.isError && <div data-testid="status-chat-error" className="flex items-center gap-2 text-xs text-destructive"><AlertCircle size={14} /> La ruta no respondió. Revisa la conexión del proveedor e inténtalo de nuevo.</div>}</div>
        <form onSubmit={submit} className="border-t border-border p-4"><div className="flex items-end gap-2 border border-border bg-background p-2 focus-within:border-primary"><textarea data-testid="input-playground-prompt" value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(e); } }} placeholder="Pregunta algo a tu modelo enrutado..." className="min-h-[48px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground" rows={2} /><Button type="submit" disabled={!prompt.trim() || chat.isPending} data-testid="button-send-chat">{chat.isPending ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}</Button></div><div className="mt-2 px-2 text-[10px] text-muted-foreground">Presiona Enter para enviar · Shift + Enter para una nueva línea</div></form>
      </section>
      <aside className="h-fit border border-border bg-card p-5">
        <div className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal size={16} className="text-primary" /> Controles de ruta</div>
        <div className="mt-6 space-y-5">
          <label className="block"><span className="field-label">Proveedor</span><select data-testid="select-playground-provider" value={providerId} onChange={e => setProviderId(e.target.value)} className="field-input"><option value="">Ruta predeterminada</option>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>)}</select></label>
          <label className="block"><span className="field-label">Tipo de tarea</span><select data-testid="select-playground-task-type" value={taskType} onChange={e => setTaskType(e.target.value as NonNullable<RouterChatInput['taskType']>)} className="field-input"><option value="chat">Conversación</option><option value="coding">Programación</option><option value="reasoning">Razonamiento</option><option value="summarization">Resumen</option><option value="vision">Visión</option><option value="document">Documentos</option></select></label>
          <label className="block"><span className="field-label">Temperatura <span className="font-normal text-muted-foreground">({temperature})</span></span><input data-testid="input-playground-temperature" type="range" min="0" max="2" step=".1" value={temperature} onChange={e => setTemperature(e.target.value)} className="mt-3 w-full accent-[hsl(var(--primary))]" /></label>
          <label className="block"><span className="field-label">Máximo de tokens</span><input data-testid="input-playground-max-tokens" type="number" min="1" max="8192" value={maxTokens} onChange={e => setMaxTokens(e.target.value)} className="field-input" /></label>
        </div>
        <div className="mt-8 border-t border-border pt-5"><div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.16em] text-primary"><LockKeyhole size={13} /> sesión privada</div><p className="mt-2 text-xs leading-5 text-muted-foreground">Este playground usa tu sesión iniciada. No expone tu token personal de API.</p></div>
      </aside>
    </div>
  </div>;
}

function ApplicationsPage() {
  const queryClient = useQueryClient();
  const tokensQuery = useListRouterAppTokens();
  const create = useCreateRouterAppToken();
  const revoke = useRevokeRouterAppToken();
  const [name, setName] = useState('');
  const [issued, setIssued] = useState<{ id: number; name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const tokens = tokensQuery.data ?? [];

  const createToken = (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || create.isPending) return;
    create.mutate(
      { data: { name: trimmedName } },
      {
        onSuccess: response => {
          setIssued(response);
          setName('');
          void queryClient.invalidateQueries({ queryKey: getListRouterAppTokensQueryKey() });
        },
      },
    );
  };

  const revokeToken = (id: number, tokenName: string) => {
    if (!window.confirm(`¿Revocar el token de "${tokenName}"? La aplicación dejará de conectarse de inmediato.`)) return;
    revoke.mutate(
      { id },
      {
        onSuccess: () => {
          if (issued?.id === id) setIssued(null);
          void queryClient.invalidateQueries({ queryKey: getListRouterAppTokensQueryKey() });
        },
      },
    );
  };

  if (tokensQuery.isLoading) return <PageLoading />;
  if (tokensQuery.isError) return <ErrorState onRetry={() => tokensQuery.refetch()} />;

  return <div className="mx-auto max-w-6xl animate-rise">
    <PageHeader eyebrow="Aplicaciones / 05" title="Una conexión independiente para cada app." description="Crea un token nombrado por aplicación, revócalo sin afectar a las demás y usa la misma API compatible con OpenAI." action={<Link href="/api-access" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm font-semibold hover:bg-muted"><Terminal size={16} /> Ver contrato API</Link>} />
    <div className="grid gap-6 lg:grid-cols-[.85fr_1.15fr]">
      <section className="h-fit border border-border bg-card p-6">
        <div className="flex items-center gap-3"><span className="rounded-lg bg-primary/10 p-2 text-primary"><KeyRound size={18} /></span><div><h2 className="font-semibold">Nuevo token de aplicación</h2><p className="mt-1 text-xs text-muted-foreground">El nombre solo sirve para identificar su uso.</p></div></div>
        <form onSubmit={createToken} className="mt-6 space-y-4">
          <label className="block"><span className="field-label">Nombre de la aplicación</span><input data-testid="input-app-token-name" value={name} onChange={event => setName(event.target.value)} maxLength={80} required placeholder="Programación en español" className="field-input" /></label>
          <Button type="submit" disabled={!name.trim() || create.isPending} data-testid="button-create-app-token" className="w-full">{create.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Crear token</Button>
          {create.isError && <p role="alert" className="text-xs text-destructive">No se pudo crear el token. Inténtalo de nuevo.</p>}
        </form>
        {issued && <div className="mt-6 rounded-lg border border-secondary/50 bg-secondary/10 p-4">
          <div className="flex items-start gap-2 text-sm font-semibold"><TriangleAlert size={16} className="mt-0.5 text-secondary-foreground" /> Copia el token de {issued.name}</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Se muestra una sola vez. Guárdalo como secreto en el servidor de esa app.</p>
          <div className="mt-3 flex items-center gap-2 rounded bg-background p-3"><code data-testid="text-issued-app-token" className="min-w-0 flex-1 break-all font-mono text-xs">{issued.token}</code><button type="button" onClick={() => { void navigator.clipboard.writeText(issued.token).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }); }} data-testid="button-copy-app-token" className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Copiar token">{copied ? <Check size={16} className="text-primary" /> : <Copy size={16} />}</button></div>
        </div>}
      </section>
      <section className="border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-semibold">Tokens activos</h2><p className="mt-1 text-xs text-muted-foreground">Cada token puede revocarse de forma independiente.</p></div><span className="rounded-full bg-muted px-2.5 py-1 font-mono text-[10px]">{tokens.length}</span></div>
        {tokens.length === 0 ? <div className="px-5 py-10 text-center"><KeyRound size={22} className="mx-auto text-muted-foreground" /><p className="mt-3 text-sm font-medium">Todavía no hay tokens de aplicación</p><p className="mt-1 text-xs text-muted-foreground">Crea uno para conectar tu primer cliente.</p></div> : <div className="divide-y divide-border">{tokens.map(token => <div key={token.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="min-w-0"><div className="truncate text-sm font-semibold">{token.name}</div><div className="mt-1 font-mono text-[10px] text-muted-foreground">{token.preview}</div><div className="mt-2 text-[10px] text-muted-foreground">Creado {formatDate(token.createdAt)} · {token.lastUsedAt ? `Último uso ${formatDate(token.lastUsedAt)}` : 'Sin uso registrado'}</div></div>
          <Button variant="danger" disabled={revoke.isPending} onClick={() => revokeToken(token.id, token.name)} data-testid={`button-revoke-app-token-${token.id}`}><Trash2 size={14} /> Revocar</Button>
        </div>)}</div>}
        {revoke.isError && <p role="alert" className="border-t border-border px-5 py-3 text-xs text-destructive">No se pudo revocar el token. Inténtalo de nuevo.</p>}
      </section>
    </div>
    <div className="mt-6 border border-sidebar-border bg-sidebar p-5 text-sidebar-foreground">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.16em] text-sidebar-primary"><LockKeyhole size={13} /> Credencial solo de servidor</div>
      <p className="mt-2 text-xs leading-5 text-sidebar-foreground/65">El token autentica llamadas a <code className="text-sidebar-primary">POST /api/v1/chat/completions</code>. No lo incluyas en código de navegador. La API no revela las claves de los proveedores.</p>
    </div>
  </div>;
}

function ApiAccessPage() {
  const queryClient = useQueryClient();
  const statusQuery = useGetRouterTokenStatus();
  const create = useCreateRouterToken();
  const revoke = useRevokeRouterToken();
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const status = statusQuery.data;
  const issue = () => create.mutate(undefined, { onSuccess: response => { setIssuedToken(response.token); queryClient.invalidateQueries({ queryKey: getGetRouterTokenStatusQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetRouterSummaryQueryKey() }); } });
  const revokeToken = () => { if (window.confirm('¿Revocar este token? Las apps que lo usan dejarán de funcionar de inmediato.')) revoke.mutate(undefined, { onSuccess: () => { setIssuedToken(null); queryClient.invalidateQueries({ queryKey: getGetRouterTokenStatusQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetRouterSummaryQueryKey() }); } }); };
  const example = `curl ${window.location.origin}/api/v1/chat/completions \\\n  -H "Authorization: Bearer $ROUTER_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"messages":[{"role":"user","content":"Hola desde mi aplicación"}]}'`;
  if (statusQuery.isLoading) return <PageLoading />;
  if (statusQuery.isError) return <ErrorState onRetry={() => statusQuery.refetch()} />;
  return <div className="mx-auto max-w-6xl animate-rise"><PageHeader eyebrow="Acceso API / 04" title="Una clave para cada app." description="Emite un token personal una sola vez y apunta tus aplicaciones al mismo endpoint estable. Al rotarlo, el token anterior se revoca de inmediato." action={<div className={`inline-flex items-center gap-2 rounded-full px-3 py-2 font-mono text-[10px] uppercase tracking-[.13em] ${status?.active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}><span className={`h-1.5 w-1.5 rounded-full ${status?.active ? 'bg-primary' : 'bg-muted-foreground/50'}`} />{status?.active ? 'token activo' : 'sin token emitido'}</div>} /><div className="grid gap-6 lg:grid-cols-[.85fr_1.15fr]"><section className="border border-border bg-card p-6"><div className="flex items-start justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.17em] text-primary">Token personal</div><h2 className="mt-3 text-2xl font-semibold">{status?.active ? 'Tu conexión está lista.' : 'Crea la conexión de tu app.'}</h2></div><KeyRound className="text-secondary" size={22} /></div>{status?.active ? <><div className="mt-8 rounded-lg border border-border bg-background p-4"><div className="field-label">Token guardado</div><div data-testid="text-token-preview" className="mt-2 font-mono text-sm tracking-wider">{status.preview || '••••••••••••'}</div><div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 size={14} className="text-primary" /> Emitido {status.createdAt ? formatDate(status.createdAt) : 'recientemente'}</div></div><div className="mt-5 flex flex-wrap gap-2">{!issuedToken && <Button onClick={issue} disabled={create.isPending} data-testid="button-rotate-token">{create.isPending ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />} Rotar token</Button>}{issuedToken && <div className="w-full rounded-lg border border-secondary/50 bg-secondary/10 p-4"><div className="flex items-start gap-2 text-sm font-semibold"><TriangleAlert size={16} className="mt-0.5 text-secondary-foreground" /> Copia este token ahora</div><p className="mt-1 text-xs leading-5 text-muted-foreground">Por seguridad, el token completo se muestra una sola vez. No podrás recuperarlo después de salir de esta página.</p><div className="mt-3 flex items-center gap-2 rounded bg-background p-3"><code data-testid="text-issued-token" className="min-w-0 flex-1 break-all font-mono text-xs">{issuedToken}</code><button type="button" onClick={() => { navigator.clipboard.writeText(issuedToken); setCopied(true); setTimeout(() => setCopied(false), 1800); }} data-testid="button-copy-token" className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Copiar token">{copied ? <Check size={16} className="text-primary" /> : <Copy size={16} />}</button></div></div>}<Button variant="danger" onClick={revokeToken} disabled={revoke.isPending} data-testid="button-revoke-token"><Trash2 size={15} /> Revocar token</Button></div></> : <><p className="mt-4 text-sm leading-6 text-muted-foreground">Tu token personal autentica apps externas sin exponer las credenciales de tus proveedores. Trátalo como una contraseña.</p><div className="mt-8 border border-secondary/40 bg-secondary/10 p-4"><div className="flex gap-2 text-sm font-semibold"><LockKeyhole size={16} className="mt-0.5 text-secondary-foreground" /> Guárdalo en una variable de entorno</div><p className="mt-2 text-xs leading-5 text-muted-foreground">Nunca lo incluyas en el control de versiones ni lo envíes desde el navegador o código cliente.</p></div><Button onClick={issue} disabled={create.isPending} data-testid="button-create-token" className="mt-6 w-full">{create.isPending ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />} Crear token personal</Button></>}</section><section className="border border-sidebar-border bg-sidebar p-6 text-sidebar-foreground"><div className="flex items-center justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.17em] text-sidebar-foreground/50">Forma de integración</div><h2 className="mt-3 text-xl font-semibold">Mantén tu app simple.</h2></div><Terminal size={21} className="text-sidebar-primary" /></div><p className="mt-3 max-w-md text-sm leading-6 text-sidebar-foreground/55">El router usa un contrato de chat compatible con OpenAI. Tu app solo necesita un endpoint, sin importar qué proveedor responda detrás.</p><div className="mt-7 overflow-hidden border border-sidebar-border bg-sidebar-accent/50"><div className="flex items-center justify-between border-b border-sidebar-border px-4 py-2.5"><span className="font-mono text-[10px] uppercase tracking-[.15em] text-sidebar-foreground/45">curl / chat del router</span><span className="text-[10px] text-sidebar-foreground/40">POST</span></div><pre data-testid="text-integration-example" className="overflow-x-auto p-4 font-mono text-[11px] leading-6 text-sidebar-foreground/75"><code>{example}</code></pre></div><div className="mt-5 flex items-start gap-2 border border-secondary/40 bg-secondary/10 p-3 text-xs leading-5 text-sidebar-foreground/70"><TriangleAlert size={15} className="mt-0.5 shrink-0 text-secondary" /><span><strong className="text-sidebar-foreground">Solo servidor:</strong> nunca expongas el Bearer token en código de navegador, frontend o cliente. Úsalo únicamente desde tu servidor.</span></div><div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-1"><div className="flex gap-3"><span className="font-mono text-xs text-sidebar-primary">01</span><span className="text-xs leading-5 text-sidebar-foreground/55">Guarda el token como <code className="text-sidebar-primary">ROUTER_TOKEN</code>.</span></div><div className="flex gap-3"><span className="font-mono text-xs text-sidebar-primary">02</span><span className="text-xs leading-5 text-sidebar-foreground/55">Llama al endpoint desde tu servidor.</span></div><div className="flex gap-3"><span className="font-mono text-xs text-sidebar-primary">03</span><span className="text-xs leading-5 text-sidebar-foreground/55">Cambia de proveedor aquí, no en cada app.</span></div></div></section></div></div>;
}

function Home() {
  return <div className="min-h-[100dvh] overflow-hidden bg-background"><header className="flex items-center justify-between border-b border-border px-5 py-5 md:px-10"><Link href="/" data-testid="link-home-logo" className="flex items-center gap-3"><IconMark small /><span className="font-semibold tracking-tight">Router IA</span></Link><div className="flex items-center gap-2"><Link href="/sign-in" data-testid="link-home-sign-in" className="rounded-lg px-3.5 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">Iniciar sesión</Link><Link href="/sign-up" data-testid="link-home-sign-up" className="rounded-lg bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground hover:brightness-95">Crear cuenta</Link></div></header><main><section className="router-grid relative mx-auto max-w-7xl px-5 pb-20 pt-20 md:px-10 md:pb-28 md:pt-28"><div className="grid items-center gap-14 lg:grid-cols-[1.1fr_.9fr]"><div className="animate-rise"><div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.16em] text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> infraestructura privada de IA</div><h1 className="max-w-3xl text-5xl font-semibold leading-[.96] tracking-[-.06em] md:text-7xl">Una ruta de entrada.<br /><span className="text-primary">Todos los modelos.</span></h1><p className="mt-7 max-w-xl text-lg leading-8 text-muted-foreground">Router IA es la sala de control compacta para tus proveedores de IA. Agrega las credenciales una vez. Dale a tus apps una API estable. Cambia quién responde sin cambiar tu producto.</p><div className="mt-9 flex flex-wrap items-center gap-3"><Link href="/sign-up" data-testid="link-hero-start" className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground hover:brightness-95">Comenzar a enrutar <ArrowRight size={17} /></Link><Link href="/sign-in" data-testid="link-hero-sign-in" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-3.5 text-sm font-semibold hover:bg-muted">Abrir sala de control</Link></div><div className="mt-9 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground"><span className="flex items-center gap-2"><LockKeyhole size={13} className="text-primary" /> las claves quedan en el servidor</span><span className="flex items-center gap-2"><Zap size={13} className="text-secondary" /> cambia sin volver a desplegar</span></div></div><div className="relative animate-rise delay-2"><div className="absolute -inset-5 rounded-full bg-primary/10 blur-3xl" /><div className="relative border border-sidebar-border bg-sidebar p-5 text-sidebar-foreground shadow-2xl md:p-7"><div className="flex items-center justify-between border-b border-sidebar-border pb-4"><div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.16em] text-sidebar-foreground/50"><Activity size={14} className="text-sidebar-primary" /> routing / en vivo</div><MoreHorizontal size={16} className="text-sidebar-foreground/40" /></div><div className="py-8"><div className="font-mono text-[10px] uppercase tracking-[.16em] text-sidebar-foreground/45">solicitud entrante</div><div className="mt-3 flex items-center gap-3"><div className="rounded bg-sidebar-accent px-3 py-2 font-mono text-xs text-sidebar-foreground/80">POST /v1/chat</div><ArrowRight size={16} className="text-sidebar-primary" /><div className="rounded bg-sidebar-primary/15 px-3 py-2 font-mono text-xs text-sidebar-primary">router</div></div></div><div className="space-y-2 border-t border-sidebar-border pt-4"><div className="flex items-center justify-between rounded-lg bg-sidebar-accent/60 p-3"><span className="flex items-center gap-3 text-sm"><span className="h-2 w-2 rounded-full bg-sidebar-primary" /> Ruta predeterminada</span><span className="font-mono text-[10px] text-sidebar-foreground/45">gpt-4o-mini</span></div><div className="flex items-center justify-between rounded-lg border border-sidebar-border p-3"><span className="flex items-center gap-3 text-sm text-sidebar-foreground/55"><span className="h-2 w-2 rounded-full bg-sidebar-foreground/30" /> Failover listo</span><span className="font-mono text-[10px] text-sidebar-foreground/35">anthropic</span></div></div><div className="signal-line mt-7 h-px" /></div></div></div></section><section className="mx-auto grid max-w-7xl gap-4 border-t border-border px-5 py-16 md:grid-cols-3 md:px-10 md:py-20"><InfoTile icon={KeyRound} title="Credenciales, una vez" body="Guarda las claves de tus proveedores en un solo lugar privado. Rótalas o reemplázalas sin tocar el código de tu producto." /><InfoTile icon={Link2} title="Un contrato estable" body="Tus apps llaman al mismo endpoint de chat, ya responda OpenAI, Anthropic, Gemini o tu propio gateway." /><InfoTile icon={SlidersHorizontal} title="Una sala de control pequeña" body="Prueba una conexión, elige una ruta predeterminada y revisa una respuesta real antes de publicar." /></section><section className="mx-auto max-w-7xl px-5 pb-24 md:px-10"><div className="border border-border bg-card p-7 md:p-12"><div className="grid gap-10 md:grid-cols-[1fr_auto] md:items-end"><div><div className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">Menos infraestructura. Más producto.</div><h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-[-.04em] md:text-5xl">Tu proveedor debería ser un ajuste, no una decisión de arquitectura.</h2></div><Link href="/sign-up" data-testid="link-home-final-cta" className="inline-flex h-fit items-center justify-center gap-2 rounded-lg bg-secondary px-5 py-3.5 text-sm font-semibold text-secondary-foreground hover:brightness-95">Construir mi ruta <ArrowRight size={16} /></Link></div></div></section></main><footer className="flex flex-col gap-3 border-t border-border px-5 py-6 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between md:px-10"><span className="font-mono uppercase tracking-[.14em]">Router IA / routing privado de IA</span><span>Una superficie pequeña. Mucho impacto.</span></footer></div>;
}

function SignInPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>;
}

function SignUpPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>;
}

function HomeRedirect() {
  return <><Show when="signed-in"><Redirect to="/dashboard" /></Show><Show when="signed-out"><Home /></Show></>;
}

function PrivateRoute({ component: Component }: { component: () => ReactNode }) {
  return <Protected><Component /></Protected>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Switch><Route path="/" component={HomeRedirect} /><Route path="/sign-in/*?" component={SignInPage} /><Route path="/sign-up/*?" component={SignUpPage} /><Route path="/dashboard">{() => <PrivateRoute component={DashboardPage} />}</Route><Route path="/providers">{() => <PrivateRoute component={ProvidersPage} />}</Route><Route path="/playground">{() => <PrivateRoute component={PlaygroundPage} />}</Route><Route path="/applications">{() => <PrivateRoute component={ApplicationsPage} />}</Route><Route path="/api-access">{() => <PrivateRoute component={ApiAccessPage} />}</Route><Route component={NotFound} /></Switch></ErrorBoundary>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => { const unsubscribe = addListener(({ user }) => { const id = user?.id ?? null; if (previous.current !== undefined && previous.current !== id) client.clear(); previous.current = id; }); return unsubscribe; }, [addListener, client]);
  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ ...esES, signIn: { ...esES.signIn, start: { ...esES.signIn?.start, title: 'Qué bueno verte de nuevo', subtitle: 'Tu capa de routing está lista.' } }, signUp: { ...esES.signUp, start: { ...esES.signUp?.start, title: 'Crea tu sala de routing', subtitle: 'Un espacio tranquilo para tu infraestructura de IA.' } } }} routerPush={to => setLocation(stripBase(to))} routerReplace={to => setLocation(stripBase(to), { replace: true })}><QueryClientProvider client={queryClient}><ClerkQueryClientCacheInvalidator /><Router /></QueryClientProvider></ClerkProvider>;
}

function App() {
  if (!clerkPubKey) throw new Error('Falta VITE_CLERK_PUBLISHABLE_KEY en el archivo .env');
  return <WouterRouter base={basePath}><ClerkProviderWithRoutes /></WouterRouter>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

export default App;