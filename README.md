# CoreX

CoreX es el repositorio central de aplicaciones e infraestructura compartida.

## Arquitectura

- GitHub: codigo fuente y versionado.
- Cloudflare: publicacion de interfaces web y ejecucion de APIs/Workers.
- Supabase: datos persistentes, configuracion y estado compartido.
- Router IA: servicio central de enrutamiento hacia proveedores de IA.

## Proyectos actuales

- `projects/router-ia/Router-IA-Privado`: Router IA, con interfaz propia y API.
- `projects/programacion-en-espanol/Programacion-en-espanol`: ProgramaHablando / Programacion en Espanol.

## Regla de plataforma

No se requiere una VM propia para ejecutar CoreX. Cada app debe poder desplegarse desde GitHub sobre servicios administrados y consumir servicios compartidos mediante APIs o bindings internos.

Ver `docs/architecture.md` para el diseño de crecimiento.
