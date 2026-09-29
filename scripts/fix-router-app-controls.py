from pathlib import Path

ROOT = Path('/tmp/router-export')
routes = ROOT / 'artifacts/api-server/src/routes/ai-router.ts'
app = ROOT / 'artifacts/router-ia/src/App.tsx'

# ---------------------------------------------------------------------------
# 1) Make app-token revoke robust in Workers/Postgres.
#    Avoid DELETE ... RETURNING and always emit JSON on failures.
# ---------------------------------------------------------------------------
text = routes.read_text()
start = text.find('router.delete("/router/app-tokens/:id", async (req, res): Promise<void> => {')
end_marker = '\n});\n\nrouter.post("/v1/chat/completions"'
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('App token revoke route not found')

old = text[start:end + len('\n});')]
new = '''router.delete("/router/app-tokens/:id", async (req, res): Promise<void> => {
  let revokeStage = "auth";
  try {
    const userId = await requireClerkUser(req, res);
    if (!userId) return;

    revokeStage = "parse";
    const params = RevokeRouterAppTokenParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message, stage: revokeStage });
      return;
    }

    revokeStage = "lookup";
    const [existing] = await db
      .select({ id: routerAppTokensTable.id })
      .from(routerAppTokensTable)
      .where(
        and(
          eq(routerAppTokensTable.userId, userId),
          eq(routerAppTokensTable.id, params.data.id),
        ),
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Application token not found.", stage: revokeStage });
      return;
    }

    revokeStage = "delete";
    await db
      .delete(routerAppTokensTable)
      .where(
        and(
          eq(routerAppTokensTable.userId, userId),
          eq(routerAppTokensTable.id, params.data.id),
        ),
      );

    RevokeRouterAppTokenResponse.parse(undefined);
    res.status(204).send();
  } catch (error) {
    try {
      console.error("Router app token revoke failed", {
        stage: revokeStage,
        error: error instanceof Error ? error.message : String(error),
      });
    } catch {}
    if (!res.headersSent) {
      res.status(500).json({
        error: `No se pudo revocar el token. Etapa: ${revokeStage}.`,
        stage: revokeStage,
      });
    }
  }
});'''
text = text.replace(old, new, 1)
routes.write_text(text)

# ---------------------------------------------------------------------------
# 2) Close the native <details> mobile menu as soon as a destination is tapped.
# ---------------------------------------------------------------------------
text = app.read_text()
close_handler = '''onClick={() => {
                const mobileMenu = document.querySelector('[data-testid="mobile-compact-nav"] details') as HTMLDetailsElement | null;
                if (mobileMenu) mobileMenu.open = false;
              }}'''

resume_marker = '''href="/dashboard"
              data-testid="link-mobile-nav-resumen"'''
if resume_marker in text and close_handler not in text:
    text = text.replace(
        resume_marker,
        'href="/dashboard"\n              ' + close_handler + '\n              data-testid="link-mobile-nav-resumen"',
        1,
    )

menu_marker = '''href={href}
                      data-testid={`link-mobile-menu-${label.toLowerCase().replace(' ', '-')}`}'''
menu_close_handler = '''onClick={() => {
                        const mobileMenu = document.querySelector('[data-testid="mobile-compact-nav"] details') as HTMLDetailsElement | null;
                        if (mobileMenu) mobileMenu.open = false;
                      }}'''
if menu_marker in text and menu_close_handler not in text:
    text = text.replace(
        menu_marker,
        'href={href}\n                      ' + menu_close_handler + '\n                      data-testid={`link-mobile-menu-${label.toLowerCase().replace(\' \', \'-\')}`}',
        1,
    )

# ---------------------------------------------------------------------------
# 3) Surface safe API diagnostics instead of a generic revoke failure.
# ---------------------------------------------------------------------------
old_error = '''{revoke.isError && <p role="alert" className="border-t border-border px-5 py-3 text-xs text-destructive">No se pudo revocar el token. Inténtalo de nuevo.</p>}'''
new_error = '''{revoke.isError && <p role="alert" className="border-t border-border px-5 py-3 text-xs text-destructive">{(() => {
          const raw = (revoke.error as Error | undefined)?.message || '';
          return /<!doctype|<html/i.test(raw) ? 'No se pudo revocar el token.' : (raw || 'No se pudo revocar el token. Inténtalo de nuevo.');
        })()}</p>}'''
if old_error in text:
    text = text.replace(old_error, new_error, 1)

app.write_text(text)

# Self-checks
route_text = routes.read_text()
app_text = app.read_text()
checks = {
    'revoke stage tracing': 'let revokeStage = "auth";' in route_text and 'revokeStage = "delete";' in route_text,
    'delete without returning': '.delete(routerAppTokensTable)' in route_text and '.returning({ id: routerAppTokensTable.id });' not in route_text[route_text.find('router.delete("/router/app-tokens/:id"'):route_text.find('router.post("/v1/chat/completions"')],
    'mobile menu auto close': 'mobileMenu.open = false' in app_text,
    'safe revoke error': '/<!doctype|<html/i.test(raw)' in app_text,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit('Router app controls fix incomplete: ' + ', '.join(failed))

print('Router app token revoke hardened and mobile menu auto-close installed')
