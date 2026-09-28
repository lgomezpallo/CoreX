from pathlib import Path

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
