from pathlib import Path

app = Path('/tmp/router-export/artifacts/router-ia/src/App.tsx')
text = app.read_text()

old_mobile_nav = '''        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-card px-4 py-2 md:hidden">
          {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`link-mobile-nav-${label.toLowerCase().replace(' ', '-')}`} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${location === href ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}><Icon size={14} />{label}</Link>)}
        </nav>
'''

new_mobile_nav = '''        <nav className="relative border-b border-border bg-card px-4 py-2 md:hidden" data-testid="mobile-compact-nav">
          <div className="flex items-center justify-between gap-2">
            <Link
              href="/dashboard"
              data-testid="link-mobile-nav-resumen"
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${location === '/dashboard' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
            >
              <LayoutDashboard size={14} />Resumen
            </Link>
            <details className="group relative">
              <summary className="list-none cursor-pointer rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                Menú
              </summary>
              <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(88vw,340px)] border border-border bg-card p-2 shadow-xl">
                <div className="grid gap-1">
                  {nav.filter(item => item.href !== '/dashboard').map(({ href, label, icon: Icon }) => (
                    <Link
                      key={href}
                      href={href}
                      data-testid={`link-mobile-menu-${label.toLowerCase().replace(' ', '-')}`}
                      className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold ${location === href ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                    >
                      <Icon size={16} />
                      <span>{label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </details>
          </div>
        </nav>
'''

if old_mobile_nav not in text:
    raise SystemExit('Mobile nav marker not found')
text = text.replace(old_mobile_nav, new_mobile_nav, 1)

old_main = '''        <main className="router-grid min-h-[calc(100dvh-4rem)] px-5 py-8 md:px-10 md:py-12">{children}</main>'''
new_main = '''        {location === '/dashboard' && (
          <section className="px-5 pt-6 md:hidden" data-testid="mobile-dashboard-launcher">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[.18em] text-primary">Inicio</div>
                <h2 className="mt-1 text-xl font-semibold">¿Qué querés abrir?</h2>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {nav.filter(item => item.href !== '/dashboard').map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex min-h-24 flex-col justify-between border border-border bg-card p-4 transition active:scale-[.99]"
                  data-testid={`dashboard-launch-${label.toLowerCase().replace(' ', '-')}`}
                >
                  <Icon size={20} className="text-primary" />
                  <div className="mt-5 flex items-center justify-between gap-2 text-sm font-semibold">
                    <span>{label}</span><ArrowRight size={14} className="text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
        <main className={`router-grid min-h-[calc(100dvh-4rem)] px-5 md:px-10 md:py-12 ${location === '/dashboard' ? 'py-6' : 'py-8'}`}>{children}</main>'''

if old_main not in text:
    raise SystemExit('Main content marker not found')
text = text.replace(old_main, new_main, 1)

# Root already resolves through HomeRedirect; keep dashboard as the signed-in home.
if "<Redirect to=\"/dashboard\"" not in text and "setLocation('/dashboard'" not in text:
    print('Warning: dashboard redirect not detected; UI launcher still installed')

app.write_text(text)
print('Router mobile navigation compacted; Dashboard is now the mobile launcher')
