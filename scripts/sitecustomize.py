from pathlib import Path
import atexit
import re

ROOT = Path('/tmp/router-export/artifacts/router-ia/src')


def _patch_exhaustive_provider_records() -> None:
    if not ROOT.exists():
        return

    touched = []
    unresolved = []

    # Match const maps typed as Record<ProviderInputKind,...> or Record<ProviderKind,...>.
    # If Cloudflare is missing, clone Groq's value. That guarantees the inserted value
    # already satisfies the exact map value type instead of guessing by wording.
    pattern = re.compile(
        r'(const\s+[A-Za-z0-9_]+\s*:\s*Record<(?:ProviderInputKind|ProviderKind),\s*[^>]+>\s*=\s*\{)(.*?)(\n\};)',
        re.S,
    )

    for p in ROOT.rglob('*'):
        if p.suffix not in {'.ts', '.tsx'}:
            continue
        text = p.read_text(errors='replace')
        original = text

        def fix_map(match: re.Match[str]) -> str:
            head, body, tail = match.groups()
            if re.search(r'(?m)^\s*cloudflare\s*:', body):
                return match.group(0)

            groq = re.search(r'(?m)^(\s*)groq\s*:\s*(.+?),\s*$', body)
            if not groq:
                unresolved.append(f'{p}: exhaustive provider map without groq/cloudflare entry')
                return match.group(0)

            indent, rhs = groq.group(1), groq.group(2)
            insertion = f'\n{indent}cloudflare: {rhs},'
            # Insert immediately after Groq to keep maps readable/stable.
            end = groq.end()
            new_body = body[:end] + insertion + body[end:]
            return head + new_body + tail

        text = pattern.sub(fix_map, text)

        # Give the two user-facing autocomplete maps Cloudflare-specific behavior.
        if p.name == 'model-autocomplete.tsx':
            text = re.sub(
                r'(?m)^(\s*)cloudflare\s*:\s*\[.*?\],\s*$',
                r'\1cloudflare: [],',
                text,
                count=1,
            )
            # Any Cloudflare string entry in this component should explain discovery,
            # rather than inheriting Groq wording.
            text = re.sub(
                r'(?m)^(\s*)cloudflare\s*:\s*([\'\"]).*?\2,\s*$',
                r"\1cloudflare: 'Catálogo automático de Workers AI',",
                text,
            )

        if text != original:
            p.write_text(text)
            touched.append(str(p.relative_to(ROOT)))

    # Hard validation: after patching, no exhaustive provider map may omit Cloudflare.
    for p in ROOT.rglob('*'):
        if p.suffix not in {'.ts', '.tsx'}:
            continue
        text = p.read_text(errors='replace')
        for match in pattern.finditer(text):
            body = match.group(2)
            if not re.search(r'(?m)^\s*cloudflare\s*:', body):
                unresolved.append(f'{p}: provider Record still missing cloudflare')

    if unresolved:
        raise RuntimeError('\n'.join(dict.fromkeys(unresolved)))

    print('Cloudflare exhaustive provider maps verified')
    if touched:
        print('Patched:', ', '.join(touched))


atexit.register(_patch_exhaustive_provider_records)
