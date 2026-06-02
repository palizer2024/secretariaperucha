// ════════════════════════════════════════════════════════════════
//  Subscription Bot — config.js
// ════════════════════════════════════════════════════════════════

module.exports = {
  // Duración por defecto de la suscripción (días)
  DURACION_DEFAULT: 30,

  // Nombre del bot
  NOMBRE_BOT: 'Subscription Bot',

  // ID del dueño del bot (admin que recibe notificaciones)
  // Fallback: 5050507537 en caso Railway no lea el .env
  ADMIN_ID: (process.env.ADMIN_ID || '5050507537').toString().trim(),

  // Token del bot
  BOT_TOKEN: process.env.BOT_TOKEN || '8903010898:AAEc1Ozkpp_nIVeF_cgdVnMZ7ivTnxF8OfU',

  // Horario del cron: 00:00 hora de Lima (UTC-5)
  // En UTC serían las 05:00
  CRON_HORARIO: '0 5 * * *',

  // Zona horaria para el cron
  CRON_TIMEZONE: 'America/Lima',

  // Límite de días que se puede configurar por grupo
  DURACION_MINIMA: 1,
  DURACION_MAXIMA: 365,
};
