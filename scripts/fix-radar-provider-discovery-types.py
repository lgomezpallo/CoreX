from pathlib import Path

p = Path('/tmp/router-export/artifacts/api-server/src/routes/ai-router.ts')
text = p.read_text()

old_head = '    const discoveredProviders: RadarProviderSignal[] = [\n'
new_head = '    const providerSignals: RadarProviderSignal[] = [\n'
old_tail = '    ].filter((provider) => provider.detected || provider.connected);\n\n    res.setHeader("Cache-Control", "private, max-age=60");\n    res.json({ ...catalog, discoveredProviders });'
new_tail = '    ];\n    const discoveredProviders = providerSignals.filter((provider) => provider.detected || provider.connected);\n\n    res.setHeader("Cache-Control", "private, max-age=60");\n    res.json({ ...catalog, discoveredProviders });'

if old_head not in text:
    raise SystemExit('Radar provider discovery head marker not found')
if old_tail not in text:
    raise SystemExit('Radar provider discovery tail marker not found')

text = text.replace(old_head, new_head, 1).replace(old_tail, new_tail, 1)
p.write_text(text)

if 'const providerSignals: RadarProviderSignal[]' not in text or 'const discoveredProviders = providerSignals.filter' not in text:
    raise SystemExit('Radar provider discovery type fix incomplete')

print('Radar provider discovery typing fixed')
