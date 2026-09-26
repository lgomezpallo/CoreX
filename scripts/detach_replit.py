from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

PROJECTS = [
    Path('projects/router-ia/Router-IA-Privado'),
    Path('projects/programacion-en-espanol/Programacion-en-espanol'),
]

REPLIT_PACKAGES = {
    '@replit/connectors-sdk',
    '@replit/vite-plugin-cartographer',
    '@replit/vite-plugin-dev-banner',
    '@replit/vite-plugin-runtime-error-modal',
}


def clean_package_json(path: Path) -> None:
    data = json.loads(path.read_text())
    changed = False
    for section in ('dependencies', 'devDependencies', 'optionalDependencies'):
        deps = data.get(section)
        if not isinstance(deps, dict):
            continue
        for key in list(deps):
            if key in REPLIT_PACKAGES or key.startswith('@replit/'):
                del deps[key]
                changed = True
    if changed:
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')


def clean_vite(path: Path) -> None:
    text = path.read_text()
    original = text

    text = re.sub(
        r"\nimport runtimeErrorOverlay from ['\"]@replit/vite-plugin-runtime-error-modal['\"];\n",
        '\n',
        text,
    )
    text = re.sub(r"\n\s*runtimeErrorOverlay\(\),", '', text)

    production_guard = r"process\.env\.NODE_ENV !== ['\"]production['\"] &&\s*process\.env\.REPL_ID !== undefined"
    text = re.sub(
        rf"\n\s*\.\.\.\({production_guard}\s*\? \[runtimeErrorOverlay\(\)\]\s*:\s*\[\]\),",
        '',
        text,
        flags=re.S,
    )
    text = re.sub(
        rf"\n\s*\.\.\.\({production_guard}\s*\? \[.*?@replit/vite-plugin-cartographer.*?\]\s*:\s*\[\]\),",
        '',
        text,
        flags=re.S,
    )
    text = re.sub(
        rf"\n\s*\.\.\.\({production_guard}\s*\? \[.*?@replit/vite-plugin-dev-banner.*?\]\s*:\s*\[\]\),",
        '',
        text,
        flags=re.S,
    )

    if text != original:
        path.write_text(text)


def clean_workspace(path: Path) -> None:
    if not path.exists():
        return
    lines = path.read_text().splitlines()
    cleaned: list[str] = []
    for line in lines:
        if '@replit/' in line or 'stripe-replit-sync' in line:
            continue
        if 'replit uses linux-x64 only' in line.lower():
            continue
        if 'Replit packsges' in line:
            line = line.replace('Replit packsges, ', '')
        if 'Exclude @replit scoped packages' in line or 'published by Replit' in line:
            continue
        cleaned.append(line)
    path.write_text('\n'.join(cleaned) + '\n')


def main() -> None:
    for root in PROJECTS:
        if not root.exists():
            raise SystemExit(f'Missing project: {root}')

        for name in ('.replit', '.replitignore'):
            target = root / name
            if target.exists():
                target.unlink()

        for target in list(root.rglob('.replit-artifact')):
            if target.is_dir():
                shutil.rmtree(target)

        for pkg in root.rglob('package.json'):
            if 'node_modules' not in pkg.parts:
                clean_package_json(pkg)

        for vite in root.rglob('vite.config.ts'):
            clean_vite(vite)

        clean_workspace(root / 'pnpm-workspace.yaml')


if __name__ == '__main__':
    main()
