# Plan: Subscription Bot Personal — SecretariaPerucha

## 🎯 Objetivo

Implementar un bot de Telegram personal que administre suscripciones por tiempo en grupos. Cuando un usuario se une al grupo, el bot inicia un contador. Al vencer el plazo, el bot expulsa automáticamente al usuario y notifica al dueño con un botón para contactarlo.

---

## 🏗️ Stack Tecnológico

| Componente | Tecnología |
|------------|-----------|
| Lenguaje | Node.js |
| Librería Telegram | `node-telegram-bot-api` |
| Base de datos | PostgreSQL vía `pg` |
| Cron | `node-cron` (1 vez al día a las 00:00) |
| Despliegue | Railway |
| Variables de entorno | `dotenv` |

## 📁 Estructura del Proyecto

```
SecretariaPerucha/
├── .env                    # BOT_TOKEN, DATABASE_URL, ADMIN_ID
├── .env.example
├── .gitignore
├── package.json
├── index.js                # Punto de entrada — toda la lógica
├── config.js               # Constantes y defaults
├── db.js                   # Conexión PostgreSQL y queries
├── railway.json            # Config Railway
└── plans/
    └── plan-subscription-bot.md
```

---

## 🗃️ Esquema de Base de Datos

### Tabla `suscripciones`

```sql
CREATE TABLE suscripciones (
  id            SERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL,
  chat_id       VARCHAR(50) NOT NULL,
  username      VARCHAR(200),
  ingreso       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duracion_dias INT NOT NULL DEFAULT 30,
  notif_3dias   BOOLEAN DEFAULT false,
  activo        BOOLEAN DEFAULT true,
  expulsado_en  TIMESTAMPTZ,
  renovado_en   TIMESTAMPTZ,
  UNIQUE(user_id, chat_id, activo)
);
```

### Tabla `config_grupo`

```sql
CREATE TABLE config_grupo (
  chat_id        VARCHAR(50) PRIMARY KEY,
  duracion_dias  INT NOT NULL DEFAULT 30,
  bot_admin      BOOLEAN DEFAULT false
);
```

---

## 🔄 Flujo Detallado

```mermaid
flowchart TD
    A[Usuario se une al grupo] --> B[Evento my_chat_member / new_chat_members]
    B --> C{¿Bot es admin del grupo?}
    C -->|Sí| D[Registrar suscripción en DB<br>user_id, chat_id, username, NOW, duracion_dias]
    C -->|No| E[Enviar alerta al admin: bot necesita permisos]
    D --> F[Enviar bienvenida privada al usuario<br>con duración de suscripción]
    
    subgraph CRON_DIARIO [Cron diario 00:00]
        G1[Query suscripciones vencidas<br>activo=true AND ingreso + duracion > NOW]
        G2[Por cada vencido:<br>banChatMember + unbanChatMember<br>UPDATE activo=false, expulsado_en=NOW]
        G3[Enviar notificación al usuario expulsado]
        
        H1[Query suscripciones que vencen MAÑANA<br>activo=true AND vence entre NOW y NOW+1 día]
        H2[Enviar notificación al admin<br>con botón tg://user?id= para cada uno]
        H3[Enviar recordatorio a usuario<br>si quedan 3 días]
        
        I1[Generar reporte diario:<br>expulsados hoy, vencen mañana, activos totales]
        I2[Enviar reporte al admin con botones por usuario]
    end
    
    D --> CRON_DIARIO
    
    subgraph COMANDOS_ADMIN [Comandos de admin de grupo]
        J[/setduracion N] --> K[Validar que quien ejecuta es admin del grupo]
        K --> L[Actualizar config_grupo.duracion_dias]
        J2[/setduracion sin args] --> M[Mostrar duración actual del grupo]
        J3[/stats] --> N[Mostrar stats del grupo:<br>total, activos, expulsados]
    end
    
    subgraph COMANDOS_USUARIO [Comandos de usuario]
        O[/start] --> P[Mensaje de bienvenida]
        Q[/tiempo] --> R[Consultar tiempo restante<br>de suscripción activa]
        S[/ayuda] --> T[Instrucciones del bot]
    end
```

---

## 📋 TODO List Detallado

### Fase 1: Inicialización del Proyecto

- [ ] **1.1 Crear `package.json`** con dependencias:
  - `node-telegram-bot-api` ^0.67.0
  - `pg` ^8.11.0
  - `node-cron` ^4.2.1
  - `dotenv` ^17.0.0
  - Script `start`: `node index.js`

- [ ] **1.2 Crear `.env.example`** con variables:
  - `BOT_TOKEN=`
  - `DATABASE_URL=`
  - `ADMIN_ID=` (ID del dueño del bot)

- [ ] **1.3 Crear `.gitignore`** con node_modules, .env, etc.

### Fase 2: Configuración

- [ ] **2.1 Crear `config.js`** con:
  - `DURACION_DEFAULT: 30` (días por defecto)
  - `NOMBRE_BOT: 'Subscription Bot'`
  - `CRON_HORARIO: '0 0 * * *'` (medianoche, UTC-5)
  - `ADMIN_ID` desde process.env
  - `BOT_TOKEN` desde process.env

### Fase 3: Base de Datos

- [ ] **3.1 Crear `db.js`** con:
  - Pool de conexión PostgreSQL usando `DATABASE_URL`
  - SSL configurado (`rejectUnauthorized: false`)
  - Función `initDB()` que crea ambas tablas con `IF NOT EXISTS`
  - Migraciones seguras (`ADD COLUMN IF NOT EXISTS`)
  - **Funciones para suscripciones:**
    - `registrarSuscripcion(userId, chatId, username, duracionDias)`
    - `getSuscripcionActiva(userId, chatId)`
    - `getSuscripcionesVencidas()` — para el cron
    - `getSuscripcionesVencenManana()` — para notificar admin
    - `getSuscripcionesRecordatorio3Dias()` — notif. al usuario
    - `expulsarSuscripcion(id)` — `UPDATE activo=false, expulsado_en=NOW`
    - `getTiempoRestante(userId, chatId)` — para `/tiempo`
    - `getStatsGrupo(chatId)` — total, activos, expulsados
  - **Funciones para configuración:**
    - `getConfigGrupo(chatId)` — obtener duración del grupo
    - `setConfigGrupo(chatId, duracionDias)` — actualizar duración

### Fase 4: Lógica Principal del Bot

- [ ] **4.1 Inicializar bot en `index.js`**
  - Cargar dotenv
  - Crear instancia de `TelegramBot` con polling
  - Inicializar BD
  - Configurar cron job
  - Manejo de errores (`polling_error`, `error`)

- [ ] **4.2 Detectar entrada de usuarios al grupo** (`my_chat_member`)
  - Escuchar evento `my_chat_member`
  - Detectar `new_chat_member.status === 'member'`
  - Verificar que el bot sea admin con `can_restrict_members`
  - Registrar suscripción en BD
  - Enviar mensaje privado de bienvenida al usuario
  - Manejar re-ingreso (re-activar suscripción si fue expulsado antes)

- [ ] **4.3 Comando `/start`**
  - Mensaje de bienvenida explicando el bot
  - Si se ejecuta en grupo, responder en privado

- [ ] **4.4 Comando `/ayuda`**
  - Instrucciones y lista de comandos disponibles

- [ ] **4.5 Comando `/tiempo`**
  - Consultar suscripción activa del usuario
  - Mostrar días restantes formateados

- [ ] **4.6 Comando `/setduracion`** (solo admins del grupo)
  - Validar que quien ejecuta es admin del grupo via `getChatAdministrators`
  - Sin argumentos: mostrar duración actual del grupo
  - Con argumento: parsear `1d`, `7d`, `30d`, etc.
  - Actualizar `config_grupo` en BD
  - Confirmar cambio al admin

- [ ] **4.7 Comando `/stats`** (solo admins del grupo)
  - Validar admin del grupo
  - Mostrar: total suscripciones, activas, expulsadas, próximas a vencer
  - Formato con emojis

### Fase 5: Cron Job y Notificaciones

- [ ] **5.1 Implementar cron diario (00:00)**
  - Programar con `node-cron` usando `CRON_HORARIO`
  - Manejar zona horaria (UTC-5, Lima)
  - Logging de ejecución

- [ ] **5.2 Expulsar suscripciones vencidas**
  - Query a `getSuscripcionesVencidas()`
  - Por cada una:
    - `banChatMember(chatId, userId)` — expulsar
    - `unbanChatMember(chatId, userId)` — desbanear
    - `expulsarSuscripcion(id)` — marcar en BD
    - Enviar mensaje privado al usuario: "Tu suscripción ha expirado"
  - Manejar errores (bot no admin, usuario ya no está, etc.)

- [ ] **5.3 Notificar admin sobre vencimientos próximos**
  - Query a `getSuscripcionesVencenManana()`
  - Por cada una, enviar mensaje al `ADMIN_ID` con:
    - Detalles: username, grupo, días, fechas
    - Botón inline: `tg://user?id={user_id}` para contactar
  - Agrupar múltiples notificaciones si es posible

- [ ] **5.4 Enviar reporte diario al admin**
  - Resumen consolidado:
    - 🔴 Expulsados hoy: N
    - 🟡 Vencen mañana: N
    - 🟢 Suscripciones activas totales: N
  - Botones inline por cada usuario afectado (expulsados + próximos)
  - Cada botón: `[✉️ @usuario - Estado]` → `tg://user?id=USER_ID`

- [ ] **5.5 Recordatorio al usuario (3 días antes)**
  - Query a `getSuscripcionesRecordatorio3Dias()`
  - Solo si `notif_3dias = false` (para no repetir)
  - Enviar mensaje privado: "⚠️ Tu suscripción vence en 3 días"
  - Marcar `notif_3dias = true`

### Fase 6: Despliegue

- [ ] **6.1 Crear `railway.json`**
  - Configuración de despliegue para Railway
  - Comando `start`: `node index.js`
  - Watch globs

- [ ] **6.2 Archivos finales**
  - Revisar que `.env.example` tenga todas las variables documentadas
  - Verificar `.gitignore` incluya `.env`

---

## ⚠️ Consideraciones Técnicas

1. **Evento `my_chat_member` vs `new_chat_members`**: El bot DEBE usar `my_chat_member` para detectar cuándo él mismo es agregado al grupo (para verificar permisos). Para detectar nuevos miembros, se usa `new_chat_members`.

2. **Permisos del bot**: El bot necesita ser administrador del grupo con `can_restrict_members`. Si no lo es, `banChatMember` fallará.

3. **Re-ingreso**: Si un usuario sale y vuelve a entrar, la UNIQUE constraint `(user_id, chat_id, activo)` permitirá insertar un nuevo registro porque el anterior tiene `activo=false`.

4. **Límite de Telegram API**: `unbanChatMember` inmediatamente después de `banChatMember` funciona, pero considerar un delay si hay rate limiting.

5. **Notificaciones privadas**: El bot solo puede enviar mensajes privados a usuarios que hayan iniciado el bot antes (con `/start`). Manejar error si `sendMessage` falla por `bot was blocked by the user`.

6. **Zona horaria**: No hay ajuste automático por zona horaria en `node-cron`. Usar `0 5 * * *` si se necesita UTC 00:00 en hora de Lima (UTC-5) → en realidad sería `0 5 * * *` para que a las 00:00 Lima se ejecute a las 05:00 UTC. O usar `cron.schedule` con `timezone: 'America/Lima'`.

7. **Formato de `/setduracion`**: Parsear `Xd` donde X es número. Soporte: `1d`, `3d`, `7d`, `15d`, `30d`, `60d`, `90d`.
