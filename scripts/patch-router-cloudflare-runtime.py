from pathlib import Path
import re

ROOT = Path('/tmp/router-export')

# Radar fetch hardening.
p = ROOT / 'artifacts/api-server/src/lib/model-radar.ts'
text = p.read_text()
text = text.replace('"https://openrouter.ai/api/v1/models?limit=1000"', '"https://openrouter.ai/api/v1/models"')
text = text.replace('const MAX_RESPONSE_BYTES = 4_000_000;', 'const MAX_RESPONSE_BYTES = 16_000_000;')
text = text.replace('redirect: "error"', 'redirect: "follow"')
text = text.replace(
    'headers: { accept: "application/json" },',
    'headers: { accept: "application/json", "user-agent": "Router-IA-Radar/1.0" },',
)
p.write_text(text)

# Wrangler: remove placeholder Hyperdrive and enable public fetch compatibility.
p = ROOT / 'wrangler.jsonc'
text = p.read_text()
pattern = r'(?ms)^\s*"hyperdrive"\s*:\s*\[\s*\{\s*"binding"\s*:\s*"HYPERDRIVE"\s*,\s*"id"\s*:\s*"REPLACE_WITH_HYPERDRIVE_CONFIG_ID"\s*,?\s*\}\s*,?\s*\]\s*,?\s*'
text, _ = re.subn(pattern, '', text, count=1)
flags_pattern = r'"compatibility_flags"\s*:\s*\[([^\]]*)\]'
match = re.search(flags_pattern, text, re.S)
if not match:
    raise SystemExit('compatibility_flags array not found')
if 'global_fetch_strictly_public' not in match.group(1):
    current = match.group(1).rstrip()
    comma = ',' if current.strip() else ''
    replacement = '"compatibility_flags": [' + current + comma + '\n    "global_fetch_strictly_public"\n  ]'
    text = text[:match.start()] + replacement + text[match.end():]
p.write_text(text)

# Workers-safe Express adapter.
p = ROOT / 'artifacts/api-server/src/cloudflare.ts'
p.write_text('''import { httpServerHandler } from "cloudflare:node";\nimport app from "./app";\n\nconst port = 3000;\napp.listen(port);\nexport default httpServerHandler({ port });\n''')

# Workers-safe logger with req.log compatibility.
p = ROOT / 'artifacts/api-server/src/lib/logger.ts'
p.write_text('''type LogArgs = unknown[];\n\nfunction log(method: "debug" | "info" | "warn" | "error", args: LogArgs): void {\n  console[method](...args);\n}\n\nexport const logger = {\n  trace: (...args: LogArgs) => log("debug", args),\n  debug: (...args: LogArgs) => log("debug", args),\n  info: (...args: LogArgs) => log("info", args),\n  warn: (...args: LogArgs) => log("warn", args),\n  error: (...args: LogArgs) => log("error", args),\n  fatal: (...args: LogArgs) => log("error", args),\n  child: () => logger,\n};\n\ndeclare global {\n  namespace Express {\n    interface Request {\n      log: typeof logger;\n    }\n  }\n}\n''')

# Remove pino-http middleware.
p = ROOT / 'artifacts/api-server/src/app.ts'
text = p.read_text().replace('import pinoHttp from "pino-http";\n', '')
marker = 'app.use(\n  pinoHttp({'
if marker in text:
    start = text.index(marker)
    end = text.index('app.use(CLERK_PROXY_PATH', start)
    replacement = '''app.use((req, _res, next) => {\n  req.log = logger;\n  req.log.info({ method: req.method, url: req.url?.split("?")[0] }, "http request");\n  next();\n});\n\napp.get("/__cloudflare_preflight", (_req, res) => {\n  res.json({ status: "ok" });\n});\n\n'''
    text = text[:start] + replacement + text[end:]
elif '/__cloudflare_preflight' not in text:
    raise SystemExit('Expected pino middleware marker not found')
p.write_text(text)

# Browser Clerk bearer bridge.
p = ROOT / 'artifacts/router-ia/src/App.tsx'
text = p.read_text()
import_marker = "  getListRouterAppTokensQueryKey,\n"
if 'setAuthTokenGetter,' not in text:
    if import_marker not in text:
        raise SystemExit('API client import marker not found')
    text = text.replace(import_marker, "  setAuthTokenGetter,\n" + import_marker, 1)
function_marker = 'function ClerkProviderWithRoutes() {'
if 'function ClerkApiAuthBridge() {' not in text:
    bridge = '''function ClerkApiAuthBridge() {\n  const { getToken, isLoaded, isSignedIn } = useAuth();\n\n  useEffect(() => {\n    if (!isLoaded || !isSignedIn) {\n      setAuthTokenGetter(null);\n      return;\n    }\n    setAuthTokenGetter(() => getToken());\n    return () => setAuthTokenGetter(null);\n  }, [getToken, isLoaded, isSignedIn]);\n\n  return null;\n}\n\n'''
    if function_marker not in text:
        raise SystemExit('ClerkProviderWithRoutes marker not found')
    text = text.replace(function_marker, bridge + function_marker, 1)
old = '<QueryClientProvider client={queryClient}><ClerkQueryClientCacheInvalidator /><Router /></QueryClientProvider>'
new = '<QueryClientProvider client={queryClient}><ClerkApiAuthBridge /><ClerkQueryClientCacheInvalidator /><Router /></QueryClientProvider>'
text = text.replace(old, new, 1)
text = text.replace('sesión local', 'sesión activa')
p.write_text(text)

print('Cloudflare runtime compatibility patches applied')
