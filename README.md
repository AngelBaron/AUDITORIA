# SICIL — Frontend

**Sistema Integral de Control de Inventarios y Logística** para LogiTech Soluciones S.A. de C.V. (empresa ficticia).
Planta/Almacén Central (CEN) y almacenes regionales Norte (NTE), Centro (CTR) y Sur (SUR).

Proyecto académico de Auditoría de Sistemas — Angel Barón García (2271014), UAEMéx.

El frontend está completo y funciona solo: incluye un **backend simulado** que aplica las mismas reglas que
deberá aplicar el backend real (permisos, segregación de funciones, estados, transacciones, bitácora). Conectar el
backend real es cambiar una variable de entorno.

---

## 1. Ejecución rápida

Requisitos: Node.js 20 o superior.

```bash
npm ci                 # instala exactamente las versiones del package-lock
npm run dev            # http://localhost:5173 (modo demostración)
```

### Cuentas de demostración

Todas usan la contraseña **`Montacargas.Azul26`**. Los roles con segundo factor piden el código **`482913`**.
En la pantalla de acceso hay un panel "Cuentas de demostración" que llena los datos con un clic.

| Correo | Persona | Rol | Alcance | MFA |
| --- | --- | --- | --- | --- |
| mdiaz@logitech.mx | Marco Díaz | Almacenista | CEN | No |
| gnavarro@logitech.mx | Gabriela Navarro | Almacenista | CEN | No |
| rmendez@logitech.mx | Rosa Méndez | Almacenista | NTE | No |
| icruz@logitech.mx | Iván Cruz | Almacenista | SUR | No |
| pluna@logitech.mx | Patricia Luna | Supervisora | CEN | Sí |
| jsalas@logitech.mx | Jorge Salas | Supervisor | NTE, SUR | Sí |
| rparedes@logitech.mx | Raúl Paredes | Almacenista + Supervisor (excepción SoD) | CTR | Sí |
| etorres@logitech.mx | Elena Torres | Gerente de logística | Todos | Sí |
| druiz@logitech.mx | Daniel Ruiz | Solicitante (ensamble) | CEN, NTE | No |
| mfuentes@logitech.mx | Mariana Fuentes | Solicitante (ventas) | CEN, SUR | No |
| svega@logitech.mx | Sofía Vega | Compras | Todos | No |
| hramirez@logitech.mx | Hugo Ramírez | Contabilidad | Todos | No |
| lcampos@logitech.mx | Laura Campos | Auditora interna | Todos (lectura) | Sí |
| therrera@logitech.mx | Tomás Herrera | Administrador de sistemas | Sistema | Sí |
| amolina@logitech.mx | Andrea Molina | Oficial de seguridad | Sistema | Sí |

El escenario cargado incluye: transferencias en tránsito y con discrepancia, un intento de autoaprobación bloqueado,
salidas fraccionadas detectadas, una cuenta bloqueada por intentos fallidos, ajustes con doble aprobación, un conteo
cíclico cerrado, una solicitud de acceso con excepción SoD y un cambio de parámetro pendiente.

> El backend simulado vive en memoria: **recargar la página reinicia los datos y cierra la sesión** (no se usa
> `localStorage`, por diseño). Navega con los enlaces de la aplicación.

### Recorrido sugerido para la revisión

1. Entra como **Daniel** → *Salidas* → *Solicitar material* → envía a aprobación.
2. Cierra sesión, entra como **Patricia** (MFA) → *Mis pendientes* → aprueba.
3. Entra como **Marco** → surte. Entra como **Daniel** → confirma con su contraseña.
4. Entra como **Raúl** → *Transferencias* → `TRF-CTR-000001`: verás el bloqueo por segregación de funciones.
5. Entra como **Rosa** → recibe a ciegas la transferencia en tránsito hacia NTE.
6. Entra como **Laura** → *Bitácora* → *Verificar integridad*; *Reportes* → *Conciliación*.

---

## 2. Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Verificación de tipos + build de producción en `dist/` |
| `npm run preview` | Sirve `dist/` con los encabezados de seguridad de producción (CSP, HSTS…) |
| `npm run typecheck` | TypeScript en modo estricto |
| `npm run lint` | ESLint con reglas de seguridad y accesibilidad, cero advertencias permitidas |
| `npm test` | 84 pruebas (unitarias, de interfaz y de auditoría PA-xx) |
| `npm run test:coverage` | Cobertura en `coverage/` |
| `npm run audit` | `npm audit` de dependencias |
| `npm run verificar` | Todo lo anterior en orden; es el criterio para entregar |

Resultado al cierre de esta versión: tipos sin errores, lint sin advertencias, 84/84 pruebas, 0 vulnerabilidades.

---

## 3. Conectar el backend real

1. Copia `.env.example` a `.env.local` y cambia `VITE_API_MODE=real`.
2. En desarrollo, `VITE_PROXY_TARGET` indica a dónde reenvía Vite las llamadas `/api` (mismo origen, sin CORS).
3. En producción el `Dockerfile` compila con `VITE_API_MODE=real` y Nginx (`nginx/nginx.conf`) sirve la app y
   redirige `/api/` al servicio `api:3000`.

Con `VITE_API_MODE=real` el backend simulado **no entra al bundle** (se verificó buscando sus datos en `dist`).

### Contrato que debe cumplir el backend

El contrato completo está tipado en `src/api/types.ts` y `src/api/cliente.ts`; `src/api/mock/` es una
especificación ejecutable de cada regla. Convenciones:

- Base `/api/v1`, JSON, sesión en **cookies HttpOnly + Secure + SameSite=Strict** (el frontend nunca ve tokens).
- `GET /auth/csrf` → `{ token }`. Toda petición que no sea GET debe traer `X-CSRF-Token`. El token se rota al iniciar sesión.
- Operaciones que mueven inventario traen `Idempotency-Key` (UUID). Repetirla devuelve la misma respuesta.
- Acciones sobre documentos traen `version`; si no coincide, responder **409 `VERSION_CONFLICTO`**.
- Errores: `{ codigo, mensaje, idCorrelacion, detalles?: [{ campo, mensaje }] }` y encabezado `x-correlation-id`.
- Códigos que el frontend interpreta: `TOKEN_EXPIRADO` (renueva y reintenta), `SESION_EXPIRADA`, `SESION_INVALIDA`,
  `CSRF_INVALIDO` (reintenta una vez), `CAMBIO_PASSWORD_REQUERIDO`, `SOD_VIOLATION`, `REAUTENTICACION_REQUERIDA`,
  `VALIDACION` (422 con `detalles`), `VERSION_CONFLICTO`.
- `GET /documentos/:id` devuelve `accionesPermitidas` y `bloqueos` **calculados por el servidor para el usuario**;
  el frontend solo muestra lo que el servidor permite.

| Método | Ruta | Uso |
| --- | --- | --- |
| POST | `/auth/login`, `/auth/mfa`, `/auth/refresh`, `/auth/logout`, `/auth/password` | Autenticación |
| GET / DELETE | `/auth/me`, `/auth/sesiones`, `/auth/sesiones/:id` | Sesión actual y sesiones abiertas |
| GET | `/almacenes`, `/motivos`, `/centros-costo`, `/proveedores` | Catálogos |
| GET / POST / PUT | `/productos`, `/productos/:id`, `/productos/:id/costos` | Catálogo de productos e historial de costo |
| GET / POST | `/ordenes-compra` | Órdenes de compra |
| GET | `/existencias`, `/kardex`, `/series/:numero`, `/series-disponibles` | Inventario |
| GET / POST | `/documentos`, `/documentos/:id`, `/documentos/:id/eventos` | Recepciones, salidas, transferencias y ajustes |
| POST | `/documentos/:id/acciones/:accion` | `enviar_aprobacion`, `aprobar`, `rechazar`, `cancelar`, `surtir`, `confirmar_entrega`, `enviar`, `recibir`, `resolver_incidencia`, `confirmar_recepcion` |
| GET / POST | `/conteos`, `/conteos/:id`, `/conteos/:id/acciones/:accion` | Conteos físicos |
| GET | `/tablero`, `/bandeja` | Inicio y pendientes del usuario |
| GET / POST | `/bitacora`, `/bitacora/verificacion`, `/bitacora/exportaciones` | Bitácora de auditoría |
| GET / POST | `/hallazgos`, `/hallazgos/:id/estado` | Hallazgos y alertas |
| GET / POST | `/reportes/*`, `/reportes/exportaciones` | Reportes y registro de exportaciones |
| GET / POST | `/periodos`, `/periodos/:clave/cierre`, `/periodos/:clave/reapertura[/resolucion]` | Cierre de periodo |
| GET / POST | `/usuarios`, `/usuarios/:id/asignaciones`, `/usuarios/:id/estado`, `/asignaciones/*`, `/permisos/matriz` | Usuarios y accesos |
| GET / POST | `/parametros`, `/parametros/:clave/propuesta`, `/parametros/:clave/resolucion` | Parámetros de control |

---

## 4. Estructura del código

```
/nginx            Configuración de producción (HTTPS, encabezados, límite de peticiones)
/public           Ícono
/src
  /api            Cliente HTTP, contrato de tipos y funciones por endpoint
    /mock         Backend simulado: motor de reglas, bitácora encadenada, escenario de datos
  /auth           Contexto de sesión y guardias de ruta
  /components     Componentes reutilizables (diálogos, tablas, adjuntos, series, exportación)
  /config         Variables de entorno validadas
  /domain         Reglas puras: permisos, estados, formatos, utilidades de seguridad
  /hooks          Carga de datos y envío con idempotencia
  /layout         Estructura de la aplicación, menú y control de inactividad
  /pages          Una carpeta por módulo funcional
  /styles         Sistema visual (tokens, base, componentes)
/tests            Pruebas unitarias, de interfaz y de auditoría
```

| Carpeta | Contenido | Función |
| --- | --- | --- |
| `src/api/http.ts` | Cliente `fetch` | CSRF, idempotencia, renovación de sesión, errores con correlación |
| `src/api/mock/motor.ts` | Motor de reglas | RBAC por almacén, SoD, máquina de estados, transacciones con rollback |
| `src/api/mock/bitacora.ts` | Bitácora | Eventos inmutables encadenados con SHA-256 y verificación |
| `src/domain/permisos.ts` | Matriz RBAC | Roles, permisos y combinaciones prohibidas |
| `src/domain/seguridad.ts` | Utilidades | Política de contraseñas, CSV seguro, validación de archivos por firma |
| `src/pages/documentos` | Movimientos | Lista, captura y detalle con acciones de recepciones, salidas, transferencias y ajustes |

---

## 5. Controles implementados en el frontend (trazables al ERS)

| Requerimiento | Implementación |
| --- | --- |
| RS-SES-02 | Sin tokens en JS ni `localStorage` (regla de ESLint lo prohíbe); cookies HttpOnly |
| RS-WEB-02 | Token anti-CSRF en peticiones que cambian estado; reintento único si expira |
| RS-TRX-07 | `Idempotency-Key` por envío; se conserva si hay error de red y se renueva tras éxito |
| RS-TRX-06 | `version` en cada acción; 409 recarga el documento y lo avisa |
| RS-SES-01, 03, 04, 06, 08 | Renovación transparente, aviso y cierre por inactividad, "Mis sesiones", último acceso e intentos fallidos |
| RS-SES-07 | Contraseña antes de aprobaciones de nivel gerencial, asignar roles, parámetros y reaperturas |
| RS-AUT-01, 03, 04, 05 | Política de contraseñas con medidor, error genérico, segundo factor, cambio obligatorio de temporal |
| RS-ACC-02, 06 | El menú y los botones dependen de permisos; el servidor valida y responde 404 a objetos ajenos |
| RS-SOD-01 a 14 | Bloqueos explicados en el documento (franja de seguridad) y validación previa de combinaciones de roles |
| RF-ENT-02, RF-TRF-04, RF-CNT-03 | Captura ciega: no se muestran cantidades esperadas, enviadas ni existencias del sistema |
| RS-VAL-04, 05, 06 | Texto saneado, adjuntos validados por firma real y SHA-256, CSV contra inyección de fórmulas |
| RS-WEB-01 | CSP sin `unsafe-inline`, HSTS, `nosniff`, `DENY`, `Referrer-Policy`, `Permissions-Policy` |
| RS-WEB-04 | Mensajes sin detalles técnicos y con referencia de correlación |
| RF-REP-07 | Exportaciones e impresiones registradas en bitácora con hash del archivo y marca de usuario |
| RNF-USA-01, 02, 03 | Interfaz en español, lector de código de barras (Enter), diseño para tableta, confirmación de acciones |
| Accesibilidad | Etiquetas asociadas, foco visible, navegación por teclado, `aria-live`, movimiento reducido |

### Pruebas de auditoría automatizadas (`tests/auditoria.test.ts`)

PA-01 a PA-11, PA-16, PA-18 a PA-23, PA-25 a PA-28 y PA-30 del plan de pruebas, más reglas adicionales
(reautenticación, conteo ciego, alcance por almacén, sesiones simultáneas, alta de usuarios con aprobación).
`npm test` sirve como evidencia del formato F-09.

---

## 6. Notas para el backend

- El backend debe repetir **todas** las validaciones: el frontend es solo una capa de conveniencia.
- Contraseñas con Argon2id; el mock las compara en tiempo constante pero las guarda en claro solo por ser simulación.
- Usar `SELECT … FOR UPDATE` en orden fijo (almacén, producto) y transacciones InnoDB, como describe el ERS sección 9.
- La bitácora real debe ser una tabla con solo `INSERT`/`SELECT` para la app y trigger que bloquee `UPDATE`/`DELETE`.
