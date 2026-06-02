// ════════════════════════════════════════════════════════════════
//  Subscription Bot — db.js (PostgreSQL)
// ════════════════════════════════════════════════════════════════
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ════════════════════════════════════════════════════════════════
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS suscripciones (
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

    CREATE TABLE IF NOT EXISTS config_grupo (
      chat_id        VARCHAR(50) PRIMARY KEY,
      duracion_dias  INT NOT NULL DEFAULT 30,
      bot_admin      BOOLEAN DEFAULT false
    );
  `);

  // Migraciones seguras
  await pool.query(`ALTER TABLE suscripciones ADD COLUMN IF NOT EXISTS notif_3dias BOOLEAN DEFAULT false`);

  console.log('✅ Base de datos inicializada');
}

// ════════════════════════════════════════════════════════════════
//  SUSCRIPCIONES
// ════════════════════════════════════════════════════════════════

/**
 * Registra una nueva suscripción para un usuario que se une al grupo.
 * Si ya existe una suscripción inactiva (expulsado antes), la re-activa.
 */
async function registrarSuscripcion(userId, chatId, username, duracionDias) {
  // Buscar si ya tuvo una suscripción en este grupo y fue expulsado
  const existente = await pool.query(
    `SELECT id FROM suscripciones
     WHERE user_id = $1 AND chat_id = $2 AND activo = false
     ORDER BY id DESC LIMIT 1`,
    [userId, chatId]
  );

  if (existente.rows.length > 0) {
    // Re-activar la suscripción anterior
    const r = await pool.query(
      `UPDATE suscripciones
       SET activo = true, ingreso = NOW(), duracion_dias = $3,
           username = $4, expulsado_en = NULL, notif_3dias = false, renovado_en = NOW()
       WHERE id = $1
       RETURNING id`,
      [existente.rows[0].id, null, duracionDias, username]
    );
    return r.rows[0].id;
  }

  // Nueva suscripción
  const r = await pool.query(
    `INSERT INTO suscripciones(user_id, chat_id, username, ingreso, duracion_dias)
     VALUES ($1, $2, $3, NOW(), $4)
     ON CONFLICT(user_id, chat_id, activo) DO NOTHING
     RETURNING id`,
    [userId, chatId, username, duracionDias]
  );
  return r.rows[0]?.id || null;
}

/**
 * Obtiene la suscripción activa de un usuario en un grupo específico.
 */
async function getSuscripcionActiva(userId, chatId) {
  const r = await pool.query(
    `SELECT * FROM suscripciones
     WHERE user_id = $1 AND chat_id = $2 AND activo = true`,
    [userId, chatId]
  );
  return r.rows[0] || null;
}

/**
 * Obtiene todas las suscripciones activas cuyo tiempo ha vencido.
 * ingreso + duracion_dias < NOW()
 */
async function getSuscripcionesVencidas() {
  const r = await pool.query(
    `SELECT * FROM suscripciones
     WHERE activo = true
     AND ingreso + (duracion_dias || ' days')::INTERVAL < NOW()`
  );
  return r.rows;
}

/**
 * Obtiene suscripciones activas que vencen entre NOW y NOW + 1 día (mañana).
 */
async function getSuscripcionesVencenManana() {
  const r = await pool.query(
    `SELECT * FROM suscripciones
     WHERE activo = true
     AND ingreso + (duracion_dias || ' days')::INTERVAL
         BETWEEN NOW() AND NOW() + INTERVAL '1 day'`
  );
  return r.rows;
}

/**
 * Obtiene suscripciones a las que les quedan EXACTAMENTE 3 días
 * y que aún no han recibido el recordatorio (notif_3dias = false).
 */
async function getSuscripcionesRecordatorio3Dias() {
  const r = await pool.query(
    `SELECT * FROM suscripciones
     WHERE activo = true
     AND notif_3dias = false
     AND ingreso + (duracion_dias || ' days')::INTERVAL
         BETWEEN NOW() + INTERVAL '3 days' AND NOW() + INTERVAL '4 days'`
  );
  return r.rows;
}

/**
 * Marca una suscripción como expulsada.
 */
async function expulsarSuscripcion(id) {
  await pool.query(
    `UPDATE suscripciones SET activo = false, expulsado_en = NOW() WHERE id = $1`,
    [id]
  );
}

/**
 * Marca que se envió el recordatorio de 3 días.
 */
async function marcarNotif3Dias(id) {
  await pool.query(
    `UPDATE suscripciones SET notif_3dias = true WHERE id = $1`,
    [id]
  );
}

/**
 * Calcula el tiempo restante de una suscripción activa.
 * Devuelve { dias_restantes, vence_en } o null si no hay suscripción activa.
 */
async function getTiempoRestante(userId, chatId) {
  const r = await pool.query(
    `SELECT id, ingreso, duracion_dias,
            ingreso + (duracion_dias || ' days')::INTERVAL AS vence_en
     FROM suscripciones
     WHERE user_id = $1 AND chat_id = $2 AND activo = true
     LIMIT 1`,
    [userId, chatId]
  );
  if (!r.rows[0]) return null;

  const row = r.rows[0];
  const ahora = new Date();
  const vence = new Date(row.vence_en);
  const diffMs = vence - ahora;
  const diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return {
    id: row.id,
    diasRestantes: Math.max(0, diasRestantes),
    venceEn: vence,
    ingresoTimestamp: row.ingreso,
    duracionDias: row.duracion_dias
  };
}

/**
 * Obtiene estadísticas de un grupo.
 */
async function getStatsGrupo(chatId) {
  const total = await pool.query(
    `SELECT COUNT(*) FROM suscripciones WHERE chat_id = $1`,
    [chatId]
  );
  const activas = await pool.query(
    `SELECT COUNT(*) FROM suscripciones WHERE chat_id = $1 AND activo = true`,
    [chatId]
  );
  const expulsadas = await pool.query(
    `SELECT COUNT(*) FROM suscripciones WHERE chat_id = $1 AND activo = false`,
    [chatId]
  );
  const proximas = await pool.query(
    `SELECT COUNT(*) FROM suscripciones
     WHERE chat_id = $1 AND activo = true
     AND ingreso + (duracion_dias || ' days')::INTERVAL
         BETWEEN NOW() AND NOW() + INTERVAL '7 days'`,
    [chatId]
  );

  return {
    total: parseInt(total.rows[0].count),
    activas: parseInt(activas.rows[0].count),
    expulsadas: parseInt(expulsadas.rows[0].count),
    proximasAVencer: parseInt(proximas.rows[0].count)
  };
}

/**
 * Obtiene el total de suscripciones activas en todos los grupos.
 */
async function getTotalActivas() {
  const r = await pool.query(
    `SELECT COUNT(*) FROM suscripciones WHERE activo = true`
  );
  return parseInt(r.rows[0].count);
}

/**
 * Obtiene expulsados en el día de hoy.
 */
async function getExpulsadosHoy() {
  const r = await pool.query(
    `SELECT COUNT(*) FROM suscripciones
     WHERE activo = false
     AND expulsado_en IS NOT NULL
     AND expulsado_en >= NOW() - INTERVAL '24 hours'`
  );
  return parseInt(r.rows[0].count);
}

// ════════════════════════════════════════════════════════════════
//  CONFIGURACIÓN DE GRUPO
// ════════════════════════════════════════════════════════════════

/**
 * Obtiene la configuración de un grupo.
 * Si no existe, crea una con valores por defecto.
 */
async function getConfigGrupo(chatId) {
  const r = await pool.query(
    `SELECT * FROM config_grupo WHERE chat_id = $1`,
    [chatId]
  );
  if (r.rows[0]) return r.rows[0];

  // Crear configuración por defecto
  await pool.query(
    `INSERT INTO config_grupo(chat_id) VALUES($1) ON CONFLICT DO NOTHING`,
    [chatId]
  );
  return { chat_id: chatId, duracion_dias: 30, bot_admin: false };
}

/**
 * Actualiza la duración de suscripción de un grupo.
 */
async function setDuracionGrupo(chatId, duracionDias) {
  await pool.query(
    `INSERT INTO config_grupo(chat_id, duracion_dias)
     VALUES($1, $2)
     ON CONFLICT(chat_id) DO UPDATE SET duracion_dias = $2`,
    [chatId, duracionDias]
  );
}

/**
 * Marca si el bot es administrador del grupo.
 */
async function setBotAdmin(chatId, esAdmin) {
  await pool.query(
    `INSERT INTO config_grupo(chat_id, bot_admin)
     VALUES($1, $2)
     ON CONFLICT(chat_id) DO UPDATE SET bot_admin = $2`,
    [chatId, esAdmin]
  );
}

/**
 * Obtiene TODAS las suscripciones activas con días restantes.
 * Para que el admin vea todos los miembros desde el chat privado.
 */
async function getTodasLasActivas() {
  const r = await pool.query(`
    SELECT s.*,
           s.ingreso + (s.duracion_dias || ' days')::INTERVAL AS vence_en,
           CEIL(EXTRACT(EPOCH FROM (s.ingreso + (s.duracion_dias || ' days')::INTERVAL - NOW())) / 86400) AS dias_restantes
    FROM suscripciones s
    WHERE s.activo = true
    ORDER BY vence_en ASC
  `);
  return r.rows;
}

module.exports = {
  initDB, pool,
  registrarSuscripcion, getSuscripcionActiva,
  getSuscripcionesVencidas, getSuscripcionesVencenManana,
  getSuscripcionesRecordatorio3Dias, expulsarSuscripcion,
  marcarNotif3Dias, getTiempoRestante,
  getStatsGrupo, getTotalActivas, getExpulsadosHoy,
  getConfigGrupo, setDuracionGrupo, setBotAdmin,
  getTodasLasActivas,
};
