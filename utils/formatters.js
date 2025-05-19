/**
 * Utilità per formattare i messaggi per gli utenti
 */
const config = require('../config');

/**
 * Formatta un timestamp in formato HH:MM usando il fuso orario italiano (UTC+2)
 * @param {Date|String} timestamp - Timestamp da formattare
 * @returns {String} - Timestamp formattato
 */
function formatTime(timestamp) {
  const date = new Date(timestamp);
  
  // Converti in fuso orario italiano (UTC+2)
  // Prende l'ora UTC e aggiunge 2 ore
  const italianHour = (date.getUTCHours() + 2) % 24;
  const minutes = date.getUTCMinutes();
  
  return `${italianHour.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * Calcola e formatta la differenza di tempo tra un timestamp e adesso
 * @param {Date|String} timestamp - Timestamp di riferimento
 * @returns {String} - Differenza di tempo formattata
 */
function formatTimeDiff(timestamp) {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMinutes = Math.floor((now - then) / 60000);
  
  if (diffMinutes < 60) {
    return `${diffMinutes} min`;
  } else {
    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    return `${hours}h ${minutes}m`;
  }
}

/**
 * Formatta uno stato di sessione in italiano
 * @param {String} status - Stato della sessione (active, completed, timeout, admin_terminated)
 * @returns {String} - Stato formattato in italiano
 */
function formatSessionStatus(status) {
  const statusMap = {
    'active': '✅ Attiva',
    'completed': '✓ Completata',
    'timeout': '⏱️ Scaduta',
    'admin_terminated': '🛑 Terminata da admin'
  };
  
  return statusMap[status] || status;
}

/**
 * Genera un messaggio di stato formattato
 * @param {Object} status - Oggetto stato del sistema
 * @returns {String} - Messaggio formattato
 */
function formatStatusMessage(status) {
  let message = `📊 *Stato attuale del sistema*\n`;
  message += `🔌 Slot occupati: *${status.slots_occupied}/${status.total_slots}*\n`;
  
  if (status.active_sessions.length > 0) {
    message += `\n⚡ *Utenti attualmente in ricarica:*\n`;
    status.active_sessions.forEach((session, index) => {
      message += `${index + 1}. @${session.username} (⏱️ termina tra *${session.remaining_minutes} min*)\n`;
    });
  } else {
    message += `\n✨ *Nessun utente attualmente in ricarica.*\n`;
  }
  
  message += `\n`;
  
  if (status.queue.length > 0) {
    message += `👥 Utenti in attesa: *${status.queue.length}*\n`;
    message += `⏱️ Tempo medio di attesa stimato: *${estimateWaitTime(status)} minuti*\n`;
    
    if (status.queue.length <= 3) {
      message += `\n🔜 *Prossimi in coda:*\n`;
      status.queue.forEach((user, index) => {
        message += `${index + 1}. @${user.username}\n`;
      });
    }
    
    message += `\nSei in coda? Per rinunciare al tuo turno, usa */cancella*.`;
  } else {
    message += `✅ *Nessun utente in coda.*\n`;
    message += `\nVuoi ricaricare? Usa */prenota* per iniziare.`;
  }
  
  return message;
}

/**
 * Genera un messaggio di aiuto formattato
 * @param {Boolean} isAdmin - Indica se l'utente è admin
 * @returns {String} - Messaggio formattato
 */
function formatHelpMessage(isAdmin = false) {
  let message = `
🔋 *Guida a SlotManager Bot* 🔋

*Come ricaricare il tuo veicolo:*

1️⃣ Usa */prenota* per richiedere una colonnina
   • Se c'è uno slot libero, riceverai l'OK per procedere
   • Se tutte le colonnine sono occupate, verrai messo in coda

2️⃣ Quando arriva il tuo turno:
   • Vai alla colonnina e attivala
   • Conferma l'inizio con */iniziato*
   • *Hai 5 minuti* per iniziare, altrimenti perderai il turno

3️⃣ Durante la ricarica:
   • Hai *${config.MAX_CHARGE_TIME} minuti* massimo a disposizione
   • Riceverai un promemoria 5 minuti prima della scadenza

4️⃣ Al termine:
   • Completa la ricarica e scollega il veicolo
   • Conferma con */terminato* per liberare lo slot

*Altri comandi utili:*

📝 */prenota* - Richiedi una colonnina o mettiti in coda
❌ */cancella* - Rinuncia al tuo posto in coda
📊 */status* - Verifica quali colonnine sono libere/occupate 
👤 */stato_utente* - Visualizza il tuo stato e eventuali penalità
❓ */help* - Visualizza questa guida
📍 */dove_sono* - Mostra l'ID della chat attuale

*Consigli:*
- Ricevuta la notifica, hai 5 minuti per iniziare
- Se cambi idea o hai un imprevisto, usa */cancella* per liberare il posto
- Rispetta il tempo massimo per la cortesia di tutti
- Ritardi frequenti comportano penalità e possibili sospensioni temporanee
`;

  // Aggiungi le istruzioni per l'admin se l'utente è admin
  if (isAdmin) {
    message += `

🔧 *COMANDI AMMINISTRATORE* 🔧

*Gestione Sistema:*
📊 */admin_status* - Stato dettagliato del sistema
📈 */admin_stats* - Statistiche del sistema
🔄 */admin_set_max_slots [numero]* - Imposta il numero massimo di slot
🔄 */admin_set_charge_time [minuti]* - Imposta il tempo massimo di ricarica
🔄 */admin_set_reminder_time [minuti]* - Imposta il tempo di promemoria
🗑️ */admin_reset_system* - Resetta completamente il sistema (richiede conferma)

*Gestione Utenti:*
⏹️ */admin_reset_slot @username* - Termina forzatamente la sessione
🚫 */admin_remove_queue @username* - Rimuove un utente dalla coda
📣 */admin_notify_all [messaggio]* - Invia un messaggio a tutti
👥 */admin_check_penalties* - Visualizza utenti con penalità

*Diagnostica:*
🔍 */dbtest* - Verifica lo stato del database
🔄 */admin_update_commands* - Aggiorna i comandi del bot
`;
  }

  return message;
}

/**
 * Genera un messaggio di aiuto per amministratori
 * @returns {String} - Messaggio formattato
 */
function formatAdminHelpMessage() {
  return formatHelpMessage(true);
}

/**
 * Stima il tempo di attesa medio basato sullo stato attuale
 * @param {Object} status - Oggetto stato del sistema
 * @returns {Number} - Tempo di attesa stimato in minuti
 */
function estimateWaitTime(status) {
  if (status.queue.length === 0) {
    return 0;
  }
  
  // Se ci sono slot liberi, il tempo di attesa è 0
  if (status.slots_available > 0) {
    return 0;
  }
  
  // Calcola il tempo medio rimanente per le sessioni attive
  let totalRemainingTime = 0;
  
  if (status.active_sessions.length > 0) {
    status.active_sessions.forEach(session => {
      totalRemainingTime += session.remaining_minutes;
    });
    
    const avgRemainingTime = Math.round(totalRemainingTime / status.active_sessions.length);
    
    // Stima basata sulla posizione in coda e sul tempo medio rimanente
    // Assumiamo che ci sia una distribuzione equa dei tempi di fine
    const queuePosition = Math.min(status.queue.length, 3); // Considera al massimo le prime 3 posizioni
    return Math.round(avgRemainingTime * queuePosition / status.active_sessions.length) + 5; // +5 minuti di buffer
  }
  
  // Fallback: stima base se non ci sono sessioni attive (improbabile)
  return 15 * Math.min(status.queue.length, 3);
}

/**
 * Formatta un messaggio per l'inizio della ricarica
 * @param {Object} session - Oggetto sessione
 * @returns {String} - Messaggio formattato
 */
function formatSessionStartMessage(session) {
  return `
✅ *Ricarica iniziata con successo!*

⏱️ Hai iniziato alle: *${formatTime(session.start_time)}*
⌛ Termine previsto: *${formatTime(session.end_time)}*
⏳ Tempo massimo: *${config.MAX_CHARGE_TIME} minuti*

📱 *Cosa fare ora:*
- Riceverai un promemoria 5 minuti prima della scadenza
- Quando termini la ricarica, scollega il veicolo
- Conferma con */terminato* per liberare lo slot

⚠️ *Importante:* Se non confermi entro il tempo massimo, riceverai penalità che potrebbero limitare l'uso futuro del servizio.
`;
}

/**
 * Formatta un messaggio per la fine della ricarica
 * @param {Object} result - Oggetto risultato con sessione e durata
 * @returns {String} - Messaggio formattato
 */
function formatSessionEndMessage(result) {
  return `
✅ *Ricarica terminata con successo!*

⏱️ Durata totale: *${result.durationMinutes} minuti*
🔋 Grazie per aver utilizzato SlotManager Bot!

👍 Hai liberato lo slot per gli altri utenti.
Vuoi prenotare una nuova ricarica? Usa */prenota*
`;
}

/**
 * Formatta un messaggio di benvenuto
 * @param {String} username - Username dell'utente
 * @param {Number} userId - ID dell'utente
 * @returns {String} - Messaggio formattato
 */
function formatWelcomeMessage(username, userId) {
  return `
👋 *Benvenuto a SlotManager Bot, @${username}!*

Questo bot gestisce la coda per le colonnine di ricarica in modo semplice e veloce.

📱 *Per iniziare subito:*

- Usa */prenota* per richiedere una colonnina
- Se tutte sono occupate, verrai messo in coda
- Riceverai una notifica quando sarà il tuo turno

📊 Per verificare lo stato delle colonnine usa */status*
❓ Per maggiori informazioni usa */help*

Buona ricarica! ⚡
`;
}

/**
 * Formatta un messaggio per un utente in coda
 * @param {String} username - Username dell'utente
 * @param {Number} userId - ID dell'utente
 * @param {Number} position - Posizione in coda
 * @returns {String} - Messaggio formattato
 */
function formatQueueMessage(username, userId, position) {
  return `
⏳ *Tutte le colonnine sono occupate in questo momento*

✅ @${username}, sei stato aggiunto in coda in posizione *#${position}*.

*Cosa succederà ora:*
- Quando si libera uno slot, gli utenti vengono avvisati in ordine di coda
- Riceverai una notifica quando sarà il tuo turno
- Avrai 5 minuti per iniziare la ricarica, dopo la notifica

*Opzioni disponibili:*
- Usa */status* per controllare la tua posizione in coda
- Usa */cancella* se cambi idea e non vuoi più attendere

Ti ringraziamo per la pazienza! 🙏
`;
}

/**
 * Formatta un messaggio per un utente con slot disponibile
 * @param {String} username - Username dell'utente
 * @param {Number} userId - ID dell'utente
 * @param {Number} maxChargeTime - Tempo massimo di ricarica
 * @returns {String} - Messaggio formattato
 */
function formatSlotAvailableMessage(username, userId, maxChargeTime) {
  return `
✅ *Ottima notizia, @${username}!*

🟢 **C'è uno slot libero, puoi procedere subito con la ricarica.**

*Ecco cosa fare:*

1️⃣ Vai alla colonnina di ricarica
2️⃣ Attivala e collega il tuo veicolo
3️⃣ Conferma l'inizio con */iniziato*

⏱️ Ricorda: hai a disposizione massimo *${maxChargeTime} minuti*.

⚠️ *Importante:* Se non confermi l'inizio con */iniziato*, lo slot rimarrà riservato per te ma non risulterai in ricarica.
`;
}

/**
 * Formatta un messaggio di notifica per un utente in coda
 * @param {String} username - Username dell'utente
 * @param {Number} userId - ID dell'utente
 * @param {Number} maxChargeTime - Tempo massimo di ricarica
 * @returns {String} - Messaggio formattato
 */
function formatNotificationMessage(username, userId, maxChargeTime) {
  return `
🔔 *È IL TUO TURNO, @${username}!*

🟢 Si è liberato uno slot di ricarica riservato per te.

*Cosa fare ora:*

1️⃣ Vai subito alla colonnina di ricarica
2️⃣ Attivala e collega il tuo veicolo
3️⃣ IMPORTANTE: Conferma l'inizio con */iniziato*

⏱️ Avrai a disposizione massimo *${maxChargeTime} minuti* per la ricarica.

⚠️ *ATTENZIONE: Hai solo 5 minuti per confermare* l'inizio con */iniziato*, altrimenti perderai il turno e lo slot passerà al prossimo utente in coda.

Se non puoi più ricaricare, usa */cancella* per liberare subito lo slot.
`;
}

/**
 * Formatta un messaggio di promemoria per la fine della ricarica
 * @param {String} username - Username dell'utente
 * @param {Number} remainingMinutes - Minuti rimanenti
 * @param {Date} endTime - Orario di fine ricarica
 * @returns {String} - Messaggio formattato
 */
function formatReminderMessage(username, remainingMinutes, endTime) {
  return `
⏰ *Promemoria ricarica, @${username}*

Ti restano solo *${remainingMinutes} minuti* prima del termine.

*Informazioni:*
- La ricarica terminerà alle *${formatTime(endTime)}*
- Prepara il veicolo per essere scollegato
- Al termine, conferma con */terminato*

Grazie per la collaborazione! Altri utenti potrebbero essere in attesa. 👍
`;
}

/**
 * Formatta un messaggio di timeout per la fine della ricarica
 * @param {String} username - Username dell'utente
 * @param {Number} maxChargeTime - Tempo massimo di ricarica
 * @returns {String} - Messaggio formattato
 */
function formatTimeoutMessage(username, maxChargeTime) {
  return `
⚠️ *TEMPO SCADUTO, @${username}*

Il tuo tempo di ricarica di *${maxChargeTime} minuti* è terminato.

*Cosa fare immediatamente:*
1. Concludi la ricarica
2. Scollega il veicolo dalla colonnina
3. Conferma con */terminato* per liberare lo slot

⚡ Altri utenti sono in attesa per utilizzare la colonnina.
Grazie per la tua collaborazione!

⚠️ *Nota:* I ritardi comportano penalità che possono limitare l'uso futuro del servizio.
`;
}

/**
 * Formatta un messaggio progressivo di ritardo
 * @param {String} username - Username dell'utente
 * @param {Number} overtimeMinutes - Minuti di ritardo
 * @returns {String} - Messaggio formattato
 */
function formatOvertimeMessage(username, overtimeMinutes) {
  if (overtimeMinutes >= 5 && overtimeMinutes < 15) {
    return `
⚠️ *ATTENZIONE*

@${username}, il tuo tempo è scaduto da *${overtimeMinutes} minuti*.

Per favore, concludi la ricarica e libera la colonnina appena possibile.
Ricorda che i ritardi comportano penalità (1 punto).
`;
  } else if (overtimeMinutes >= 15 && overtimeMinutes < 30) {
    return `
🔴 *RITARDO SIGNIFICATIVO*

@${username}, il tuo tempo è scaduto da *${overtimeMinutes} minuti*!

Ti preghiamo di liberare immediatamente la colonnina.
⚠️ Stai accumulando 2 punti penalità per questo ritardo.
Al raggiungimento di 10 punti il tuo account sarà temporaneamente sospeso.
`;
  } else if (overtimeMinutes >= 30) {
    return `
🚨 *VIOLAZIONE GRAVE*

@${username}, il tuo tempo è scaduto da *${overtimeMinutes} minuti*!

Stai impedendo ad altri utenti di utilizzare la colonnina.
🔴 *Questo comportamento comporta 3 punti penalità per ogni 30 minuti di ritardo e potrebbe portare al ban*

Libera IMMEDIATAMENTE la colonnina.
`;
  }

  return "";
}

/**
 * Formatta un messaggio per lo stato utente
 * @param {Object} user - Utente
 * @returns {String} - Messaggio formattato
 */
function formatUserStatusMessage(user) {
  let message = `👤 *Il tuo stato attuale*\n\n`;
  
  message += `Username: @${user.username}\n`;
  message += `Ricariche completate: *${user.total_charges}*\n`;
  message += `Tempo totale di ricarica: *${user.total_time} min*\n`;
  
  if (user.penalty_points > 0) {
    message += `⚠️ Punti penalità: *${user.penalty_points}*\n`;
    message += `Ultimo ritardo: ${formatDate(user.last_penalty_date)}\n`;
    
    if (user.temporarily_banned) {
      message += `🚫 *Account temporaneamente sospeso fino al ${formatDate(user.ban_end_date)}*\n`;
    } else if (user.penalty_points >= 7) {
      message += `⚠️ *Attenzione: sei vicino alla soglia di sospensione (10 punti)*\n`;
    }
    
    message += `\nI punti penalità vengono azzerati 30 giorni dopo l'ultimo ritardo.`;
  } else {
    message += `✅ Nessuna penalità attiva\n`;
  }
  
  return message;
}

/**
 * Formatta una data in formato italiano
 * @param {Date} date - Data
 * @returns {String} - Data formattata
 */
function formatDate(date) {
  if (!date) return 'N/A';
  
  const options = { 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  };
  
  return new Date(date).toLocaleDateString('it-IT', options);
}

module.exports = {
  formatTime,
  formatTimeDiff,
  formatSessionStatus,
  formatStatusMessage,
  formatHelpMessage,
  formatAdminHelpMessage,
  estimateWaitTime,
  formatSessionStartMessage,
  formatSessionEndMessage,
  formatWelcomeMessage,
  formatQueueMessage,
  formatSlotAvailableMessage,
  formatNotificationMessage,
  formatReminderMessage,
  formatTimeoutMessage,
  formatOvertimeMessage,
  formatUserStatusMessage,
  formatDate
};
