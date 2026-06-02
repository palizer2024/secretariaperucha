// ════════════════════════════════════════════════════════════════
//  Subscription Bot — index.js
//  Bot personal que administra suscripciones por tiempo en grupos
// ════════════════════════════════════════════════════════════════

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const { DURACION_DEFAULT, NOMBRE_BOT, ADMIN_ID, BOT_TOKEN, CRON_HORARIO, CRON_TIMEZONE, DURACION_MINIMA, DURACION_MAXIMA } = require('./config');
const db = require('./db');

// ════════════════════════════════════════════════════════════════
//  VALIDACIÓN INICIAL
// ════════════════════════════════════════════════════════════════
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN no está definido en .env');
  process.exit(1);
}
if (!ADMIN_ID) {
  console.error('❌ ADMIN_ID no está definido en .env');
  process.exit(1);
}

// ════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN DEL BOT
// ════════════════════════════════════════════════════════════════
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Helper para enviar mensajes con parse_mode HTML
const send = async (chatId, text, extra = {}) => {
  try {
    return await bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...extra });
  } catch (e) {
    console.error(`❌ Error enviando mensaje a ${chatId}:`, e.message);
    return null;
  }
};

// Helper para enviar mensaje privado a un usuario
const sendPrivate = async (userId, text, extra = {}) => {
  try {
    return await bot.sendMessage(userId, text, { parse_mode: 'HTML', ...extra });
  } catch (e) {
    // El usuario puede haber bloqueado al bot o no haber iniciado conversación
    console.error(`⚠️ No se pudo enviar mensaje privado a ${userId}:`, e.message);
    return null;
  }
};

// Formatea una fecha a DD/MM/AAAA
const formatDate = (date) => {
  const d = new Date(date);
  return d.toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' });
};

// ════════════════════════════════════════════════════════════════
//  EVENTO: Bot agregado al grupo / cambios de permisos
// ════════════════════════════════════════════════════════════════
bot.on('my_chat_member', async (msg) => {
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return;

  const newStatus = msg.new_chat_member.status;
  const chatId = String(msg.chat.id);

  // El bot fue agregado al grupo
  if (newStatus === 'member' || newStatus === 'administrator') {
    const esAdmin = newStatus === 'administrator';
    const puedeRestringir = msg.new_chat_member.can_restrict_members || false;

    await db.setBotAdmin(chatId, esAdmin);

    // Obtener configuración del grupo (se crea con defaults si no existe)
    const config = await db.getConfigGrupo(chatId);

    // Notificar al admin del bot
    let texto = `✅ Bot agregado al grupo <b>${msg.chat.title}</b>\n`;
    texto += `• Rol: ${esAdmin ? '👑 Administrador' : '👤 Miembro'}\n`;
    texto += `• Puede restringir: ${puedeRestringir ? '✅ Sí' : '❌ No'}\n`;
    texto += `• Duración por defecto: ${config.duracion_dias} días`;

    if (!puedeRestringir) {
      texto += '\n\n⚠️ <b>El bot necesita permisos de administrador para expulsar usuarios.</b>\n' +
               'Conviértelo en admin del grupo con "can_restrict_members" activado.';
    }

    await sendPrivate(ADMIN_ID, texto);
    console.log(`📌 Bot agregado al grupo: ${msg.chat.title} (${chatId}) — Admin: ${esAdmin}`);
  }

  // El bot fue eliminado del grupo
  if (newStatus === 'left' || newStatus === 'kicked') {
    console.log(`📌 Bot eliminado del grupo: ${msg.chat.title} (${chatId})`);
    await sendPrivate(ADMIN_ID, `❌ Bot eliminado del grupo <b>${msg.chat.title}</b>`);
  }
});

// ════════════════════════════════════════════════════════════════
//  EVENTO: Nuevos miembros se unen al grupo
// ════════════════════════════════════════════════════════════════
bot.on('new_chat_members', async (msg) => {
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return;

  const chatId = String(msg.chat.id);

  for (const member of msg.new_chat_members) {
    // Ignorar si es el propio bot
    if (member.is_bot) continue;

    const userId = member.id;
    const username = member.username || `${member.first_name || ''} ${member.last_name || ''}`.trim() || 'Usuario';

    try {
      // Obtener configuración del grupo
      const config = await db.getConfigGrupo(chatId);
      const duracion = config.duracion_dias || DURACION_DEFAULT;

      // Registrar suscripción
      const subId = await db.registrarSuscripcion(userId, chatId, username, duracion);

      if (subId) {
        console.log(`🟢 Nueva suscripción: @${username} en grupo ${msg.chat.title} — ${duracion} días`);

        // Enviar bienvenida privada
        const vence = new Date(Date.now() + duracion * 24 * 60 * 60 * 1000);
        await sendPrivate(userId,
          `👋 <b>¡Bienvenido al grupo!</b>\n\n` +
          `Has sido registrado con una suscripción de <b>${duracion} días</b>.\n` +
          `Tu suscripción vence el <b>${formatDate(vence)}</b>.\n\n` +
          `Usa /tiempo para ver tu tiempo restante.\n` +
          `Usa /ayuda para más información.`
        );
      }
    } catch (e) {
      console.error(`❌ Error registrando a ${username} en ${chatId}:`, e.message);
    }
  }
});

// ════════════════════════════════════════════════════════════════
//  COMANDO: /start
// ════════════════════════════════════════════════════════════════
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const chatType = msg.chat.type;

  // Si es en grupo, responder en privado
  if (chatType === 'group' || chatType === 'supergroup') {
    try {
      await sendPrivate(userId,
        `👋 <b>¡Hola! Soy ${NOMBRE_BOT}</b>\n\n` +
        `Administro suscripciones por tiempo en este grupo.\n\n` +
        `📌 <b>Comandos disponibles:</b>\n` +
        `/tiempo — Ver tu tiempo restante\n` +
        `/ayuda — Instrucciones detalladas\n\n` +
        `Si eres administrador del grupo:\n` +
        `/setduracion — Ver/configurar duración\n` +
        `/stats — Estadísticas del grupo`
      );
    } catch {
      // El usuario no ha iniciado el bot, responder en el grupo
      await send(chatId,
        `👋 <b>¡Hola! Soy ${NOMBRE_BOT}</b>\n\n` +
        `Envíame /start en privado para interactuar conmigo: @${NOMBRE_BOT.replace(/\s/g, '')}` +
        `\n\n<i>O escríbeme directamente para ver mis comandos.</i>`
      );
    }
    return;
  }

  // Chat privado
  await send(chatId,
    `👋 <b>¡Bienvenido a ${NOMBRE_BOT}!</b>\n\n` +
    `Soy un bot que administra suscripciones por tiempo en grupos de Telegram.\n\n` +
    `📌 <b>Comandos:</b>\n` +
    `/tiempo — Ver el tiempo restante de tu suscripción\n` +
    `/ayuda — Instrucciones detalladas\n\n` +
    `🔧 <b>Para admins del grupo:</b>\n` +
    `/setduracion [Nd] — Configurar duración (ej: /setduracion 30d)\n` +
    `/stats — Ver estadísticas del grupo`
  );
});

// ════════════════════════════════════════════════════════════════
//  COMANDO: /ayuda
// ════════════════════════════════════════════════════════════════
bot.onText(/\/ayuda/, async (msg) => {
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;

  const texto =
    `📖 <b>Ayuda — ${NOMBRE_BOT}</b>\n\n` +
    `<b>¿Qué hace este bot?</b>\n` +
    `Cuando un usuario se une al grupo, el bot inicia un contador de suscripción. ` +
    `Al vencer el plazo, el usuario es expulsado automáticamente.\n\n` +
    `<b>Comandos para todos:</b>\n` +
    `• /start — Mensaje de bienvenida\n` +
    `• /tiempo — Ver cuánto tiempo te queda\n` +
    `• /ayuda — Esta ayuda\n\n` +
    `<b>Comandos para administradores del grupo:</b>\n` +
    `• /setduracion — Ver duración actual\n` +
    `• /setduracion 7d — Cambiar a 7 días\n` +
    `• /setduracion 30d — Cambiar a 30 días\n` +
    `• /stats — Estadísticas del grupo\n\n` +
    `<b>Notificaciones:</b>\n` +
    `• Al unirte: mensaje de bienvenida con tu duración\n` +
    `• 3 días antes: recordatorio de vencimiento\n` +
    `• Al vencer: aviso de expulsión\n\n` +
    `❓ ¿Dudas? Contacta al administrador del bot.`;

  if (chatType === 'group' || chatType === 'supergroup') {
    try {
      await sendPrivate(msg.from.id, texto);
    } catch {
      await send(chatId, texto);
    }
  } else {
    await send(chatId, texto);
  }
});

// ════════════════════════════════════════════════════════════════
//  COMANDO: /tiempo
// ════════════════════════════════════════════════════════════════
bot.onText(/\/tiempo/, async (msg) => {
  const userId = msg.from.id;
  const chatType = msg.chat.type;
  const chatId = msg.chat.id;

  // Si es chat privado, necesita saber en qué grupo preguntar
  if (chatType === 'private') {
    await send(chatId,
      `📅 Para consultar tu tiempo restante, escribe /tiempo en el grupo donde estás suscrito.\n\n` +
      `Si no recuerdas en qué grupos estás, contacta al administrador.`
    );
    return;
  }

  // En grupo
  if (chatType === 'group' || chatType === 'supergroup') {
    const chatIdStr = String(chatId);
    const tiempo = await db.getTiempoRestante(userId, chatIdStr);

    if (!tiempo) {
      await send(chatId,
        `ℹ️ No tienes una suscripción activa en este grupo, @${msg.from.username || msg.from.first_name}.\n\n` +
        `Las suscripciones se crean automáticamente cuando entras al grupo.`,
        { reply_to_message_id: msg.message_id }
      );
      return;
    }

    if (tiempo.diasRestantes <= 0) {
      await send(chatId,
        `⚠️ <b>Tu suscripción ha vencido</b>, @${msg.from.username || msg.from.first_name}.\n\n` +
        `Serás expulsado del grupo en la próxima ejecución del mantenimiento diario.`,
        { reply_to_message_id: msg.message_id }
      );
      return;
    }

    await send(chatId,
      `⏱ <b>Tiempo restante</b>, @${msg.from.username || msg.from.first_name}\n\n` +
      `• Días restantes: <b>${tiempo.diasRestantes}</b>\n` +
      `• Suscripción: ${tiempo.duracionDias} días\n` +
      `• Ingresaste: ${formatDate(tiempo.ingresoTimestamp)}\n` +
      `• Vence: ${formatDate(tiempo.venceEn)}`,
      { reply_to_message_id: msg.message_id }
    );
  }
});

// ════════════════════════════════════════════════════════════════
//  COMANDO: /setduracion (solo admins del grupo)
// ════════════════════════════════════════════════════════════════
bot.onText(/\/setduracion(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const chatType = msg.chat.type;

  if (chatType !== 'group' && chatType !== 'supergroup') {
    await send(chatId, '❌ Este comando solo funciona en grupos.');
    return;
  }

  // Validar que quien ejecuta es admin del grupo
  try {
    const admins = await bot.getChatAdministrators(chatId);
    const esAdmin = admins.some(a => a.user.id === userId);

    if (!esAdmin) {
      await send(chatId,
        `❌ Solo los administradores del grupo pueden usar este comando.`,
        { reply_to_message_id: msg.message_id }
      );
      return;
    }
  } catch (e) {
    console.error('❌ Error verificando admins:', e.message);
    await send(chatId, '❌ Error al verificar permisos. Asegúrate de que el bot sea admin del grupo.');
    return;
  }

  const chatIdStr = String(chatId);

  // Sin argumentos: mostrar duración actual
  if (!match[1]) {
    const config = await db.getConfigGrupo(chatIdStr);
    await send(chatId,
      `📅 <b>Configuración del grupo</b>\n\n` +
      `• Duración actual: <b>${config.duracion_dias} días</b>\n\n` +
      `<b>Para cambiar:</b>\n` +
      `/setduracion 1d — 1 día\n` +
      `/setduracion 7d — 1 semana\n` +
      `/setduracion 15d — 15 días\n` +
      `/setduracion 30d — 1 mes\n` +
      `/setduracion 60d — 2 meses\n` +
      `/setduracion 90d — 3 meses\n\n` +
      `<i>Usa un número entre ${DURACION_MINIMA} y ${DURACION_MAXIMA} días.</i>`,
      { reply_to_message_id: msg.message_id }
    );
    return;
  }

  // Con argumento: cambiar duración
  const dias = parseInt(match[1]);

  if (isNaN(dias) || dias < DURACION_MINIMA || dias > DURACION_MAXIMA) {
    await send(chatId,
      `❌ Valor inválido. Usa un número entre ${DURACION_MINIMA} y ${DURACION_MAXIMA}.\n\n` +
      `Ejemplos:\n` +
      `/setduracion 7d — 1 semana\n` +
      `/setduracion 30d — 1 mes`,
      { reply_to_message_id: msg.message_id }
    );
    return;
  }

  await db.setDuracionGrupo(chatIdStr, dias);
  await send(chatId,
    `✅ <b>Duración actualizada</b>\n\n` +
    `A partir de ahora, los nuevos usuarios tendrán una suscripción de <b>${dias} días</b>.\n\n` +
    `Los usuarios ya registrados mantienen su duración actual.`,
    { reply_to_message_id: msg.message_id }
  );
});

// ════════════════════════════════════════════════════════════════
//  COMANDO: /stats (solo admins del grupo)
// ════════════════════════════════════════════════════════════════
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const chatType = msg.chat.type;

  if (chatType !== 'group' && chatType !== 'supergroup') {
    await send(chatId, '❌ Este comando solo funciona en grupos.');
    return;
  }

  // Validar admin
  try {
    const admins = await bot.getChatAdministrators(chatId);
    const esAdmin = admins.some(a => a.user.id === userId);
    if (!esAdmin) {
      await send(chatId, `❌ Solo los administradores pueden usar este comando.`);
      return;
    }
  } catch (e) {
    console.error('❌ Error verificando admins:', e.message);
    return;
  }

  const chatIdStr = String(chatId);
  const config = await db.getConfigGrupo(chatIdStr);
  const stats = await db.getStatsGrupo(chatIdStr);

  await send(chatId,
    `📊 <b>Estadísticas del grupo</b>\n\n` +
    `• Duración configurada: <b>${config.duracion_dias} días</b>\n` +
    `• Total registrados: <b>${stats.total}</b>\n` +
    `• Suscripciones activas: <b>${stats.activas}</b>\n` +
    `• Expulsados: <b>${stats.expulsadas}</b>\n` +
    `• Próximos a vencer (7 días): <b>${stats.proximasAVencer}</b>\n\n` +
    `<i>Usa /setduracion para cambiar la duración.</i>`
  );
});

// ════════════════════════════════════════════════════════════════
//  CRON DIARIO
// ════════════════════════════════════════════════════════════════
async function ejecutarCronDiario() {
  console.log(`🕐 Ejecutando cron diario — ${new Date().toISOString()}`);

  // ── A) EXPULSAR SUSCRIPCIONES VENCIDAS ─────────────────────
  const expulsados = [];
  try {
    const vencidas = await db.getSuscripcionesVencidas();
    console.log(`  → ${vencidas.length} suscripciones vencidas encontradas`);

    for (const sub of vencidas) {
      try {
        await bot.banChatMember(sub.chat_id, sub.user_id);
        // Pequeña pausa para que Telegram procese el ban
        await new Promise(r => setTimeout(r, 200));
        await bot.unbanChatMember(sub.chat_id, sub.user_id);
        await db.expulsarSuscripcion(sub.id);

        expulsados.push(sub);
        console.log(`  ✅ Expulsado: @${sub.username} del grupo ${sub.chat_id}`);

        // Notificar al usuario expulsado
        await sendPrivate(sub.user_id,
          `⛔ <b>Tu suscripción ha expirado</b>\n\n` +
          `Has sido expulsado del grupo.\n\n` +
          `Si deseas volver a unirte, contacta al administrador del grupo.`
        );
      } catch (e) {
        console.error(`  ❌ Error expulsando a @${sub.username} (${sub.user_id}):`, e.message);
      }
    }
  } catch (e) {
    console.error('❌ Error en expulsión de vencidos:', e.message);
  }

  // ── B) NOTIFICAR AL ADMIN SOBRE VENCIMIENTOS MAÑANA ───────
  const notificacionesAdmin = [];
  try {
    const vencenManana = await db.getSuscripcionesVencenManana();
    console.log(`  → ${vencenManana.length} suscripciones vencen mañana`);

    for (const sub of vencenManana) {
      try {
        const vence = new Date(sub.ingreso);
        vence.setDate(vence.getDate() + sub.duracion_dias);
        const grupoNombre = sub.chat_id; // No tenemos nombre de grupo aquí

        // Obtener nombre del grupo
        let nombreGrupo = grupoNombre;
        try {
          const chat = await bot.getChat(sub.chat_id);
          nombreGrupo = chat.title || grupoNombre;
        } catch {}

        const texto = `⚠️ <b>Recordatorio de vencimiento</b>\n\n` +
          `El usuario ${sub.username ? '@' + sub.username : 'ID: ' + sub.user_id} será expulsado <b>MAÑANA</b>\n` +
          `• Grupo: ${nombreGrupo}\n` +
          `• Suscripción: ${sub.duracion_dias} días\n` +
          `• Ingresó: ${formatDate(sub.ingreso)}\n` +
          `• Vence: ${formatDate(vence)}`;

        await sendPrivate(ADMIN_ID, texto, {
          reply_markup: {
            inline_keyboard: [[
              {
                text: `✉️ Hablar con ${sub.username || 'Usuario'}`,
                url: `tg://user?id=${sub.user_id}`
              }
            ]]
          }
        });

        notificacionesAdmin.push(sub);
      } catch (e) {
        console.error(`  ❌ Error notificando admin sobre @${sub.username}:`, e.message);
      }
    }
  } catch (e) {
    console.error('❌ Error en notificaciones de vencimiento:', e.message);
  }

  // ── C) RECORDATORIO A USUARIOS (3 DÍAS ANTES) ────────────
  try {
    const recordatorio3dias = await db.getSuscripcionesRecordatorio3Dias();
    console.log(`  → ${recordatorio3dias.length} usuarios a 3 días del vencimiento`);

    for (const sub of recordatorio3dias) {
      try {
        const vence = new Date(sub.ingreso);
        vence.setDate(vence.getDate() + sub.duracion_dias);

        await sendPrivate(sub.user_id,
          `⚠️ <b>Recordatorio</b>\n\n` +
          `Tu suscripción vence en <b>3 días</b> (${formatDate(vence)}).\n\n` +
          `Si necesitas más tiempo, contacta al administrador del grupo.`
        );

        await db.marcarNotif3Dias(sub.id);
      } catch (e) {
        console.error(`  ❌ Error recordatorio 3 días a @${sub.username}:`, e.message);
      }
    }
  } catch (e) {
    console.error('❌ Error en recordatorio 3 días:', e.message);
  }

  // ── D) ENVIAR REPORTE DIARIO AL ADMIN ─────────────────────
  try {
    const totalActivas = await db.getTotalActivas();
    const expulsadosHoy = await db.getExpulsadosHoy();
    const vencenManana = notificacionesAdmin;

    let reporte = `📊 <b>Reporte diario — ${NOMBRE_BOT}</b>\n`;
    reporte += `─────────────────────────\n`;
    reporte += `🔴 Expulsados hoy: <b>${expulsadosHoy}</b>\n`;
    reporte += `🟡 Vencen mañana: <b>${vencenManana.length}</b>\n`;
    reporte += `🟢 Suscripciones activas totales: <b>${totalActivas}</b>\n`;

    // Botones por cada usuario afectado
    const botones = [];
    for (const sub of expulsados) {
      botones.push([{
        text: `✉️ ${sub.username || 'ID:' + sub.user_id} - Expulsado`,
        url: `tg://user?id=${sub.user_id}`
      }]);
    }
    for (const sub of vencenManana) {
      botones.push([{
        text: `✉️ ${sub.username || 'ID:' + sub.user_id} - Vence mañana`,
        url: `tg://user?id=${sub.user_id}`
      }]);
    }

    // Organizar en filas de 2 botones
    const filasBotones = [];
    for (let i = 0; i < botones.length; i += 2) {
      if (botones[i + 1]) {
        filasBotones.push([botones[i][0], botones[i + 1][0]]);
      } else {
        filasBotones.push([botones[i][0]]);
      }
    }

    await sendPrivate(ADMIN_ID, reporte, {
      reply_markup: filasBotones.length > 0 ? { inline_keyboard: filasBotones } : undefined
    });
  } catch (e) {
    console.error('❌ Error enviando reporte diario:', e.message);
  }

  console.log(`✅ Cron diario completado — ${new Date().toISOString()}`);
}

// ════════════════════════════════════════════════════════════════
//  MANEJO DE ERRORES
// ════════════════════════════════════════════════════════════════
bot.on('polling_error', (error) => {
  // Ignorar errores fatales de conexión (se reconecta solo)
  if (!error.message.includes('EFATAL') && !error.message.includes('409')) {
    console.error('❌ Polling error:', error.message);
  }
});

bot.on('error', (error) => {
  console.error('❌ Bot error:', error.message);
});

// ════════════════════════════════════════════════════════════════
//  ARRANQUE
// ════════════════════════════════════════════════════════════════
(async () => {
  console.log(`🤖 ${NOMBRE_BOT} iniciando...`);

  try {
    // Inicializar base de datos
    await db.initDB();
    console.log('✅ Conexión a PostgreSQL establecida');
  } catch (err) {
    console.error('❌ Error conectando a PostgreSQL:', err.message);
    process.exit(1);
  }

  // Programar cron diario
  // CRON_HORARIO = '0 5 * * *' → 00:00 hora de Lima (UTC-5)
  cron.schedule(CRON_HORARIO, () => {
    ejecutarCronDiario();
  }, {
    timezone: CRON_TIMEZONE
  });

  console.log(`⏰ Cron programado: ${CRON_HORARIO} (${CRON_TIMEZONE})`);
  console.log(`🤖 ${NOMBRE_BOT} iniciado correctamente`);
  console.log(`👑 Admin ID: ${ADMIN_ID}`);
})();
