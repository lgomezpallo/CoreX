# Estándar Replit -> Router IA

Usar este texto al crear o adaptar una aplicación en Replit:

> Esta aplicación debe quedar preparada desde el inicio para conectarse a mi servicio externo Router IA.
>
> No integres directamente APIs de OpenAI, Groq, Gemini, NVIDIA, Anthropic, Mistral, Cohere, Hugging Face ni ningún otro proveedor de IA dentro de la aplicación.
>
> Toda función de inteligencia artificial debe pasar exclusivamente por un módulo desacoplado llamado RouterClient.
>
> La aplicación debe usar estas variables de servidor:
> - ROUTER_URL
> - ROUTER_APP_KEY
>
> ROUTER_URL debe apuntar al servicio Router IA. ROUTER_APP_KEY será una App Key emitida por Router IA para esta aplicación.
>
> La App Key es solo de servidor. Nunca debe guardarse en localStorage, sessionStorage, variables VITE_, código frontend, archivos públicos ni control de versiones.
>
> En Configuración debe existir una sección visible Router IA con estado Desconectado / Conectado y un botón Probar conexión. Si falta ROUTER_APP_KEY, indicar claramente que debe agregarse como secreto del runtime. No pedir ni guardar claves de proveedores individuales.
>
> Crear un único cliente reutilizable (por ejemplo router-client.ts) con una interfaz equivalente a router.run({ task, messages, metadata }).
>
> Los tipos de tarea deben contemplar al menos chat, coding, reasoning, summarization, vision y document.
>
> La aplicación no debe seleccionar proveedores ni modelos concretos. Esa decisión corresponde exclusivamente a Router IA. Si Router IA cambia de proveedor, agrega modelos o hace fallback, la aplicación no debe requerir cambios.
>
> Para chat usar el endpoint OpenAI-compatible POST /api/v1/chat/completions con Authorization: Bearer ROUTER_APP_KEY. No enviar un proveedor fijo ni una API key externa.
>
> Mantener RouterClient aislado del resto de la aplicación para que cambiar ROUTER_URL o rotar ROUTER_APP_KEY no obligue a rediseñar la app.
>
> Antes de considerar terminada la aplicación, verificar que el backend compila, que la prueba de Router IA funciona con una App Key válida y que ninguna credencial de proveedor quedó embebida en el proyecto.

Para adaptar una app existente, agregar al final:

> No rediseñes ni reestructures la aplicación existente. Agregá únicamente la capa RouterClient y reemplazá las llamadas actuales de IA para que pasen por ella.
