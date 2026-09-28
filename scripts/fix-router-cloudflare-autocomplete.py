from pathlib import Path
import re

p = Path('/tmp/router-export/artifacts/router-ia/src/components/model-autocomplete.tsx')
text = p.read_text()

# Ensure every exhaustive ProviderInputKind map includes Cloudflare.
# Suggestions map: Cloudflare has no manual suggestions because discovery is automatic.
if 'cloudflare: []' not in text:
    text, count = re.subn(
        r'(const\s+MODEL_SUGGESTIONS\s*:\s*Record<ProviderInputKind,\s*ModelSuggestion\[\]>\s*=\s*\{.*?\n)(\};)',
        lambda m: m.group(1) + "  cloudflare: [],\n" + m.group(2),
        text,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise SystemExit('Could not patch MODEL_SUGGESTIONS map')

# Placeholder/help map: insert structurally before the closing brace regardless of wording.
if not re.search(r'cloudflare\s*:\s*[\'\"]Catálogo automático de Workers AI[\'\"]', text):
    text, count = re.subn(
        r'(const\s+[A-Z_]+\s*:\s*Record<ProviderInputKind,\s*string>\s*=\s*\{.*?\n)(\};)',
        lambda m: m.group(1) + "  cloudflare: 'Catálogo automático de Workers AI',\n" + m.group(2),
        text,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise SystemExit('Could not patch ProviderInputKind string map')

p.write_text(text)
print('Cloudflare autocomplete exhaustive maps fixed')
