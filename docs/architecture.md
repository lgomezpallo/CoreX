# Arquitectura CoreX

## Objetivo

Permitir sumar nuevas aplicaciones sin crear ni mantener maquinas virtuales.

## Capas compartidas

### GitHub
Repositorio canonico para codigo, workflows y configuracion no secreta.

### Cloudflare
- Assets estaticos para interfaces React/Vite.
- Workers para APIs y logica.
- Service Bindings para comunicacion interna entre Workers cuando convenga.

### Supabase
Persistencia central. Cada aplicacion puede tener sus propias tablas/esquemas, manteniendo separacion logica.

### Router IA
Servicio comun para proveedores IA. Las aplicaciones no necesitan conocer claves de proveedores ni implementar su propio fallback/ranking.

## Flujo objetivo

```text
App A -----\
App B ------> Router IA ---> Providers IA
App C -----/      |
                  +-------> Supabase

GitHub ---> Cloudflare deployments
```

## Convenciones para nuevas apps

1. Todo codigo vive en GitHub.
2. Ninguna app depende de disco local persistente ni systemd.
3. Secretos fuera del repositorio.
4. Frontend estatico siempre que sea posible.
5. Backend solo cuando la app realmente lo necesite.
6. IA compartida a traves de Router IA.
7. Persistencia compartida en Supabase con separacion por aplicacion.
8. Cada app debe tener health/build checks reproducibles.

## Migracion actual

### Router IA
- Mantener interfaz propia.
- Migrar la API Express al runtime de Cloudflare Workers o separar una capa Worker compatible.
- Mantener Supabase como base persistente.
- Exponer API publica solo donde haga falta; preferir Service Bindings para apps internas de CoreX.

### ProgramaHablando
- Publicar frontend React/Vite como assets estaticos.
- Reutilizar Router IA para tareas de IA.
- Mantener backend propio solo para funciones que no pertenezcan al Router.

## Crecimiento

Una nueva aplicacion deberia agregar principalmente su carpeta de codigo y su configuracion de despliegue. GitHub, Cloudflare, Supabase y Router IA son infraestructura compartida, no cuatro infraestructuras nuevas por aplicacion.
