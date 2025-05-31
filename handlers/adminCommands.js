/**
 * Handler dei comandi amministrativi
 * Gestisce tutte le funzionalità riservate agli amministratori
 */
const config = require('../config');
const logger = require('../utils/logger');
const userHandler = require('./userHandler');
const queueHandler = require('./queueHandler');
const sessionHandler = require('./sessionHandler');
const formatters = require('../utils/formatters');
const Queue = require('../models/queue');
const Session = require('../models/session');
const User = require('../models/user');
const System = require('../models/system');
const penaltySystem = require('../utils/penaltySystem');

class AdminCommands {
  /**
   * Imposta i comandi del bot su Telegram
   * @param {Object} bot - Istanza del bot Telegram
   * @returns {Promise<void>}
   */
  async setupBotCommands(bot) {
    try {
      // Imposta i comandi utente (visibili a tutti)
      await bot.setMyCommands([
        { command: 'start', description: 'Avvia il bot' },
        { command: 'prenota', description: 'Prenota uno slot o mettiti in coda' },
        { command: 'cancella', description: 'Cancella la tua prenotazione in coda' },
        { command: 'iniziato', description: 'Conferma l\'inizio della ricarica o specifica durata' },
        { command: 'terminato', description: 'Conferma la fine della ricarica' },
        { command: 'status', description: 'Visualizza lo stato attuale del sistema' },
        { command: 'stato_utente', description: 'Visualizza il tuo stato e penalità' },
        { command: 'help', description: 'Mostra i comandi disponibili' },
        { command: 'dove_sono', description: 'Mostra ID della chat corrente' }
      ]);
      
      logger.info('User commands updated successfully');
      
      // Imposta i comandi admin (visibili solo all'admin)
      try {
        if (config.ADMIN_USER_ID) {
          await bot.setMyCommands([
            // Comandi utente visibili anche all'admin
            { command: 'start', description: 'Avvia il bot' },
            { command: 'prenota', description: 'Prenota uno slot o mettiti in coda' },
            { command: 'cancella', description: 'Cancella la tua prenotazione in coda' },
            { command: 'iniziato', description: 'Conferma l\'inizio della ricarica o specifica durata' },
            { command: 'terminato', description: 'Conferma la fine della ricarica' },
            { command: 'status', description: 'Visualizza lo stato attuale del sistema' },
            { command: 'stato_utente', description: 'Visualizza il tuo stato e penalità' },
            { command: 'help', description: 'Mostra tutti i comandi disponibili' },
            { command: 'dove_sono', description: 'Mostra ID della chat corrente' },
            
            // Comandi admin
            { command: 'admin_status', description: 'Stato dettagliato del sistema' },
            { command: 'admin_stats', description: 'Statistiche del sistema' },
            { command: 'admin_set_max_slots', description: 'Imposta il numero massimo di slot' },
            { command: 'admin_set_charge_time', description: 'Imposta il tempo massimo di ricarica' },
            { command: 'admin_set_reminder_time', description: 'Imposta il tempo di promemoria' },
            { command: 'admin_reset_slot', description: 'Termina forzatamente la sessione di un utente' },
            { command: 'admin_remove_queue', description: 'Rimuove un utente dalla coda' },
            { command: 'admin_check_penalties', description: 'Visualizza utenti con penalità' },
            { command: 'admin_notify_all', description: 'Invia un messaggio a tutti gli utenti' },
            { command: 'admin_reset_system', description: 'Resetta completamente il sistema' },
            { command: 'admin_help', description: 'Mostra i comandi admin disponibili' },
            { command: 'dbtest', description: 'Verifica lo stato del database' },
            { command: 'admin_update_commands', description: 'Aggiorna i comandi del bot' }
          ], { scope: { type: 'chat', chat_id: config.ADMIN_USER_ID } });
          
          logger.info('Admin commands updated successfully');
        }
      } catch (error) {
        logger.error('Error setting admin commands:', error);
      }
    } catch (error) {
      logger.error('Error setting bot commands:', error);
    }
  }

  /**
   * Gestisce il comando admin_update_commands
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   */
  async handleUpdateCommands(bot, chatId) {
    try {
      await this.setupBotCommands(bot);
      bot.sendMessage(chatId, '✅ Comandi del bot aggiornati con successo!');
    } catch (error) {
      logger.error('Error in /admin_update_commands command:', error);
      bot.sendMessage(chatId, `❌ Errore durante l'aggiornamento dei comandi: ${error.message}`);
    }
  }

  /**
   * Gestisce il comando admin_help
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   */
  async handleAdminHelp(bot, chatId) {
    try {
      // Comando help admin
      const helpMessage = formatters.formatAdminHelpMessage();
      bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error in /admin_help command:', error);
      bot.sendMessage(chatId, `❌ Errore: ${error.message}`);
    }
  }

  /**
   * Gestisce il comando admin_check_penalties
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   */
  async handleCheckPenalties(bot, chatId) {
    try {
      // Ottieni utenti con penalità
      const usersWithPenalties = await User.find({
        $or: [
          { penalty_points: { $gt: 0 } },
          { temporarily_banned: true }
        ]
      }).sort({ penalty_points: -1 });
      
      if (usersWithPenalties.length === 0) {
        bot.sendMessage(chatId,
          `✅ *Nessuna penalità attiva*\n\n` +
          `Non ci sono utenti con punti penalità o ban temporanei.`,
          { parse_mode: 'Markdown' });
        return;
      }
      
      let message = `📊 *Utenti con penalità*\n\n`;
      
      usersWithPenalties.forEach(user => {
        message += `👤 @${user.username} (ID: ${user.telegram_id}):\n`;
        message += `   • Punti penalità: *${user.penalty_points}*\n`;
        
        if (user.last_penalty_date) {
          message += `   • Ultima penalità: ${formatters.formatDate(user.last_penalty_date)}\n`;
        }
        
        if (user.temporarily_banned) {
          message += `   • 🚫 *Bannato fino al ${formatters.formatDate(user.ban_end_date)}*\n`;
        }
        
        message += `\n`;
      });
      
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error in /admin_check_penalties command:', error);
      bot.sendMessage(chatId, `❌ Errore: ${error.message}`);
    }
  }

  /**
   * Gestisce il comando admin_set_charge_time
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   * @param {Number} userId - ID dell'utente
   * @param {String} username - Username dell'utente
   * @param {Object} msg - Messaggio Telegram
   * @param {Array} args - Argomenti del comando
   */
  async handleSetChargeTime(bot, chatId, userId, username, msg, args) {
    try {
      if (args.length < 1 || isNaN(parseInt(args[0]))) {
        bot.sendMessage(chatId, '❌ Uso: /admin_set_charge_time [minuti]');
        return;
      }
      
      const minutes = parseInt(args[0]);
      if (minutes < 1 || minutes > 120) {
        bot.sendMessage(chatId, '❌ Il tempo di ricarica deve essere tra 1 e 120 minuti.');
        return;
      }
      
      // Aggiorna la configurazione
      config.MAX_CHARGE_TIME = minutes;
      
      // Aggiorna anche l'environment variable se possibile
      if (process.env.MAX_CHARGE_TIME) {
        process.env.MAX_CHARGE_TIME = minutes.toString();
      }
      
      bot.sendMessage(chatId, `✅ Tempo massimo di ricarica predefinito impostato a ${minutes} minuti.\n\nGli utenti possono comunque impostare un tempo personalizzato con /iniziato [minuti].`);
    } catch (error) {
      logger.error('Error in /admin_set_charge_time command:', error);
      bot.sendMessage(chatId, `❌ Errore: ${error.message}`);
    }
  }

  /**
   * Gestisce il comando admin_set_reminder_time
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   * @param {Number} userId - ID dell'utente
   * @param {String} username - Username dell'utente
   * @param {Object} msg - Messaggio Telegram
   * @param {Array} args - Argomenti del comando
   */
  async handleSetReminderTime(bot, chatId, userId, username, msg, args) {
    try {
      if (args.length < 1 || isNaN(parseInt(args[0]))) {
        bot.sendMessage(chatId, '❌ Uso: /admin_set_reminder_time [minuti]');
        return;
      }
      
      const minutes = parseInt(args[0]);
      if (minutes < 1 || minutes > 30) {
        bot.sendMessage(chatId, '❌ Il tempo di promemoria deve essere tra 1 e 30 minuti.');
        return;
      }
      
      // Aggiorna la configurazione
      config.REMINDER_TIME = minutes;
      
      // Aggiorna anche l'environment variable se possibile
      if (process.env.REMINDER_TIME) {
        process.env.REMINDER_TIME = minutes.toString();
      }
      
      bot.sendMessage(chatId, `✅ Tempo di promemoria impostato a ${minutes} minuti.`);
    } catch (error) {
      logger.error('Error in /admin_set_reminder_time command:', error);
      bot.sendMessage(chatId, `❌ Errore: ${error.message}`);
    }
  }

  /**
   * Gestisce il comando admin_set_max_slots
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   * @param {Number} userId - ID dell'utente
   * @param {String} username - Username dell'utente
   * @param {Object} msg - Messaggio Telegram
   * @param {Array} args - Argomenti del comando
   */
  async handleSetMaxSlots(bot, chatId, userId, username, msg, args) {
    try {
      if (args.length < 1 || isNaN(parseInt(args[0]))) {
        bot.sendMessage(chatId, '❌ Uso: /admin_set_max_slots [numero]');
        return;
      }
      
      const maxSlots = parseInt(args[0]);
      logger.info(`Admin setting max slots to ${maxSlots}`);
      
      try {
        // Usa direttamente la funzione di queueHandler
        const system = await queueHandler.updateMaxSlots(maxSlots);
        
        // Notifica l'admin
        bot.sendMessage(chatId, 
          `✅ Numero massimo di slot aggiornato a *${maxSlots}*.\n\n` +
          `ℹ️ Stato attuale: *${system.slots_available}* slot disponibili.`,
          { parse_mode: 'Markdown' });
        
        // Se sono stati aggiunti nuovi slot disponibili, notifica gli utenti in coda
        if (system.slots_available > 0) {
          await queueHandler.notifyNextInQueue(bot);
        }
        
        logger.info(`Max slots updated to ${maxSlots}, available: ${system.slots_available}`);
      } catch (error) {
        logger.error(`Error updating max slots to ${maxSlots}:`, error);
        bot.sendMessage(chatId, `❌ Errore durante l'aggiornamento del numero massimo di slot: ${error.message}`);
      }
    } catch (error) {
      logger.error('Error in /admin_set_max_slots command:', error);
      bot.sendMessage(chatId, `❌ Errore: ${error.message}`);
    }
  }

  /**
   * Gestisce il comando admin_reset_slot
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   * @param {Number} userId - ID dell'utente
   * @param {String} username - Username dell'utente
   * @param {Object} msg - Messaggio Telegram
   * @param {Array} args - Argomenti del comando
   */
  async handleResetSlot(bot, chatId, userId, username, msg, args) {
    try {
      if (args.length < 1) {
        bot.sendMessage(chatId, '❌ Uso: /admin_reset_slot @username');
        return;
      }
      
      // Estrai username dall'argomento
      const targetUsername = args[0].replace('@', '');
      
      try {
        const result = await sessionHandler.adminTerminateSession(targetUsername);
        
        if (!result) {
          bot.sendMessage(chatId, `❌ Nessuna sessione attiva trovata per l'utente @${targetUsername}.`);
          return;
        }
        
        const { session, durationMinutes } = result;
        
        // Determina se la sessione aveva durata personalizzata
        const durationInfo = session.custom_duration 
          ? `(durata personalizzata: ${session.duration_minutes} min)` 
          : `(durata predefinita: ${config.MAX_CHARGE_TIME} min)`;
        
        bot.sendMessage(chatId, 
          `✅ Sessione di @${targetUsername} terminata forzatamente.\n\n` +
          `Slot ${session.slot_number} ora disponibile.\n` +
          `Durata sessione: ${durationMinutes} minuti ${durationInfo}.`,
          { parse_mode: 'Markdown' });
        
        // Notifica l'utente della terminazione forzata
        bot.sendMessage(session.telegram_id, 
          `ℹ️ *Sessione terminata dall'amministratore*\n\n` +
          `La tua sessione di ricarica è stata terminata da un amministratore.\n` +
          `Se hai domande, contatta l'assistenza.`,
          { parse_mode: 'Markdown' });
        
        // Notifica il prossimo utente in coda
        await queueHandler.notifyNextInQueue(bot);
      } catch (error) {
        logger.error(`Error resetting slot for ${targetUsername}:`, error);
        bot.sendMessage(chatId, `❌ Errore: ${error.message}`);
      }
    } catch (error) {
      logger.error('Error in /admin_reset_slot command:', error);
      bot.sendMessage(chatId, `❌ Errore: ${error.message}`);
    }
  }

  /**
   * Gestisce il comando admin_remove_queue
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   * @param {Number} userId - ID dell'utente
   * @param {String} username - Username dell'utente
   * @param {Object} msg - Messaggio Telegram
   * @param {Array} args - Argomenti del comando
   */
  async handleRemoveQueue(bot, chatId, userId, username, msg, args) {
    try {
      if (args.length < 1) {
        bot.sendMessage(chatId, '❌ Uso: /admin_remove_queue @username');
        return;
      }
      
      // Estrai username dall'argomento
      const targetUsername = args[0].replace('@', '');
      
      try {
        const removed = await queueHandler.adminRemoveFromQueue(targetUsername);
        
        if (!removed) {
          bot.sendMessage(chatId, `❌ Utente @${targetUsername} non trovato in coda.`);
          return;
        }
        
        bot.sendMessage(chatId, 
          `✅ Utente @${targetUsername} rimosso dalla coda con successo.\n\n` +
          `Era in posizione #${removed.position}.`,
          { parse_mode: 'Markdown' });
        
        // Notifica l'utente della rimozione
        bot.sendMessage(removed.telegram_id, 
          `ℹ️ *Rimosso dalla coda*\n\n` +
          `Sei stato rimosso dalla coda da un amministratore.\n` +
          `Se hai domande, contatta l'assistenza.`,
          { parse_mode: 'Markdown' });
      } catch (error) {
        logger.error(`Error removing ${targetUsername} from queue:`, error);
        bot.sendMessage(chatId, `❌ Errore: ${error.message}`);
      }
    } catch (error) {
      logger.error('Error in /admin_remove_queue command:', error);
      bot.sendMessage(chatId, `❌ Errore: ${error.message}`);
    }
  }

  /**
   * Gestisce il comando admin_notify_all
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   * @param {Number} userId - ID dell'utente
   * @param {String} username - Username dell'utente
   * @param {Object} msg - Messaggio Telegram
   */
  async handleNotifyAll(bot, chatId, userId, username, msg) {
    try {
      // Estrai il messaggio da inviare a tutti (tutto dopo /admin_notify_all)
      const fullText = msg.text;
      const commandEnd = fullText.indexOf(' ');
      
      if (commandEnd === -1 || commandEnd === fullText.length - 1) {
        bot.sendMessage(chatId, '❌ Uso: /admin_notify_all [messaggio da inviare]');
        return;
      }
      
      const message = fullText.substring(commandEnd + 1);
      
      // Ottieni tutti gli utenti
      const users = await User.find().select('telegram_id');
      
      if (users.length === 0) {
        bot.sendMessage(chatId, '❌ Nessun utente registrato nel sistema.');
        return;
      }
      
      // Conferma all'admin
      bot.sendMessage(chatId, 
        `🔄 Invio del messaggio a ${users.length} utenti in corso...\n\n` +
        `Messaggio:\n${message}`,
        { parse_mode: 'Markdown' });
      
      // Contatori per successi e fallimenti
      let successCount = 0;
      let failureCount = 0;
      
      // Invia il messaggio a tutti gli utenti
      const notificationMessage = 
        `📢 *Annuncio dell'amministratore*\n\n` +
        `${message}`;
      
      for (const user of users) {
        try {
          await bot.sendMessage(user.telegram_id, notificationMessage, { parse_mode: 'Markdown' });
          successCount++;
        } catch (err) {
          logger.warn(`Failed to send notification to user ${user.telegram_id}:`, err);
          failureCount++;
        }
        
        // Breve pausa per evitare di superare i limiti di Telegram
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Notifica all'admin del completamento
      bot.sendMessage(chatId, 
        `✅ Invio completato!\n\n` +
        `✓ Inviati con successo: ${successCount}\n` +
        `✗ Falliti: ${failureCount}`,
        { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error in /admin_notify_all command:', error);
      bot.sendMessage(chatId, `❌ Errore: ${error.message}`);
    }
  }

  /**
   * Gestisce il comando admin_reset_system
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   */
  async handleResetSystem(bot, chatId) {
    try {
      bot.sendMessage(chatId, 
        `⚠️ *ATTENZIONE: Questa operazione resetterà completamente il sistema*\n\n` +
        `Verranno eliminati:\n` +
        `- Tutte le sessioni attive\n` +
        `- Tutte le code\n` +
        `- Tutte le configurazioni\n\n` +
        `Gli utenti e le loro statistiche NON verranno eliminati.\n\n` +
        `Per confermare, digita /admin_confirm_reset\n` +
        `Per annullare, ignora questo messaggio.`,
        { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error in /admin_reset_system command:', error);
      bot.sendMessage(chatId, `❌ Errore: ${error.message}`);
    }
  }

  /**
   * Gestisce il comando admin_confirm_reset
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   */
  async handleConfirmReset(bot, chatId) {
    try {
      logger.warn('Admin initiating system reset');
      
      // Comunica l'inizio dell'operazione
      bot.sendMessage(chatId, 
        `🔄 *Reset del sistema in corso...*\n\n` +
        `Attendere prego.`,
        { parse_mode: 'Markdown' });
      
      // 1. Elimina tutte le sessioni attive
      const deletedSessions = await Session.deleteMany({ status: 'active' });
      
      // 2. Elimina tutte le code
      const deletedQueues = await Queue.deleteMany({});
      
      // 3. Reset configurazione sistema
      let system = await System.findOne({ name: 'system' });
      
      if (!system) {
        system = new System();
      } else {
        system.slots_available = config.MAX_SLOTS;
        system.active_sessions = [];
        system.queue_length = 0;
      }
      
      await system.save();
      
      // 4. Notifica agli utenti
      const activeUsers = await User.find({
        last_charge: { $exists: true, $ne: null }
      }).limit(100).select('telegram_id');
      
      for (const user of activeUsers) {
        try {
          await bot.sendMessage(user.telegram_id, 
            `ℹ️ *Notifica di Sistema*\n\n` +
            `Il sistema è stato resettato dall'amministratore.\n` +
            `Tutte le sessioni attive e le code sono state cancellate.\n\n` +
            `Se desideri ricaricare, utilizza nuovamente il comando /prenota.`,
            { parse_mode: 'Markdown' });
        } catch (err) {
          // Ignora errori nell'invio delle notifiche
          logger.warn(`Failed to notify user ${user.telegram_id} about system reset:`, err);
        }
        
        // Breve pausa per evitare di superare i limiti di Telegram
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // 5. Notifica all'admin del completamento
      bot.sendMessage(chatId, 
        `✅ *Reset del sistema completato con successo!*\n\n` +
        `- Sessioni attive eliminate: ${deletedSessions.deletedCount}\n` +
        `- Code eliminate: ${deletedQueues.deletedCount}\n` +
        `- Sistema reinizializzato con ${config.MAX_SLOTS} slot disponibili\n` +
        `- Notifica inviata agli utenti attivi\n\n` +
        `Il sistema è ora pronto all'uso.`,
        { parse_mode: 'Markdown' });
      
      logger.info('System reset complete');
    } catch (error) {
      logger.error('Error in /admin_confirm_reset command:', error);
      bot.sendMessage(chatId, `❌ Errore durante il reset del sistema: ${error.message}`);
    }
  }

  /**
   * Gestisce il comando admin_status
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   */
  async handleAdminStatus(bot, chatId) {
    try {
      // Ottieni lo stato completo del sistema
      const status = await queueHandler.getSystemStatus();
      
      let message = `📊 *STATO DETTAGLIATO DEL SISTEMA*\n\n`;
      
      // Informazioni sulle colonnine
      message += `🔌 *Colonnine*\n`;
      message += `- Totali: ${status.total_slots}\n`;
      message += `- Disponibili: ${status.slots_available}\n`;
      message += `- Occupate: ${status.slots_occupied}\n\n`;
      
      // Informazioni dettagliate sulle sessioni attive
      message += `⚡ *Sessioni attive:* ${status.active_sessions.length}\n`;
      
      if (status.active_sessions.length > 0) {
        message += `\n`;
        status.active_sessions.forEach((session, index) => {
          // Aggiungi indicazione se la durata è personalizzata
          const durationInfo = session.custom_duration 
            ? `(durata personalizzata: ${session.duration_minutes} min)` 
            : `(durata predefinita: ${session.duration_minutes || config.MAX_CHARGE_TIME} min)`;
            
          message += `${index + 1}. Slot #${session.slot_number}: @${session.username} ${durationInfo}\n`;
          message += `   • Inizio: ${formatters.formatTime(session.start_time)}\n`;
          message += `   • Fine prevista: ${formatters.formatTime(session.end_time)}\n`;
          message += `   • Tempo rimasto: ${session.remaining_minutes} min\n`;
          
          // Se il tempo è scaduto, mostra quanto è in ritardo
          if (session.remaining_minutes <= 0) {
            message += `   • ⚠️ *In ritardo di ${Math.abs(session.remaining_minutes)} min*\n`;
          }
          
          message += `\n`;
        });
      } else {
        message += `Nessuna sessione attiva al momento.\n\n`;
      }
      
      // Informazioni sulla coda
      message += `👥 *Coda*: ${status.queue.length} utenti\n`;
      
      if (status.queue.length > 0) {
        message += `\n`;
        status.queue.forEach((user, index) => {
          message += `${index + 1}. @${user.username}\n`;
          message += `   • In coda da: ${formatters.formatTimeDiff(user.request_time)}\n`;
          
          if (user.notified) {
            message += `   • ✉️ Notificato: ${formatters.formatTimeDiff(user.notification_time)}\n`;
          }
          
          message += `\n`;
        });
      } else {
        message += `Nessun utente in coda al momento.\n\n`;
      }
      
      // Informazioni di sistema
      const system = await System.findOne({ name: 'system' });
      if (system) {
        message += `🔧 *Info sistema*\n`;
        message += `- Ricariche completate: ${system.total_charges_completed}\n`;
        message += `- Ultimo aggiornamento: ${formatters.formatDate(system.updatedAt)}\n\n`;
      }
      
      // Informazioni su penalità
      const bannedUsers = await User.countDocuments({ temporarily_banned: true });
      const usersWithPenalties = await User.countDocuments({ penalty_points: { $gt: 0 } });
      
      message += `⚠️ *Penalità*\n`;
      message += `- Utenti con penalità: ${usersWithPenalties}\n`;
      message += `- Utenti bannati: ${bannedUsers}\n`;
      message += `- Verifica dettagliata: /admin_check_penalties\n\n`;
      
      // Informazioni sulle variabili di configurazione
      message += `⚙️ *Configurazione attuale*\n`;
      message += `- Slot totali: ${config.MAX_SLOTS}\n`;
      message += `- Tempo massimo predefinito: ${config.MAX_CHARGE_TIME} min\n`;
      message += `- Tempo promemoria: ${config.REMINDER_TIME} min\n`;
      message += `- Gli utenti possono impostare una durata personalizzata con /iniziato [minuti]\n`;
      
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error in /admin_status command:', error);
      bot.sendMessage(chatId, `❌ Errore: ${error.message}`);
    }
  }

  /**
   * Gestisce il comando admin_stats
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   */
  async handleAdminStats(bot, chatId) {
    try {
      // Ottieni le statistiche complete
      const stats = await queueHandler.getSystemStats();
      
      // Dividi il messaggio in parti più piccole per evitare problemi di parsing
      let message1 = `📊 *STATISTICHE DEL SISTEMA*\n\n`;
      
      // Prima parte: Statistiche generali
      message1 += `⚡ *Utilizzo colonnine*\n`;
      message1 += `- Colonnine totali: ${stats.total_slots}\n`;
      message1 += `- Totale ricariche completate: ${stats.total_charges_completed}\n`;
      message1 += `- Ricariche oggi: ${stats.charges_today}\n`;
      message1 += `- Tempo medio di ricarica: ${stats.avg_charge_time} min\n\n`;
      
      // Seconda parte: Statistiche utenti
      message1 += `👥 *Utenti*\n`;
      message1 += `- Utenti totali: ${stats.total_users}\n`;
      message1 += `- Utenti attivi (ultimi 30 giorni): ${stats.active_users}\n`;
      message1 += `- Utenti con penalità: ${stats.users_with_penalties}\n`;
      message1 += `- Utenti bannati: ${stats.banned_users}\n`;
      
      // Invia il primo messaggio
      await bot.sendMessage(chatId, message1, { parse_mode: 'Markdown' });
      
      // Terza parte: Stato attuale
      let message2 = `🔌 *Stato attuale*\n`;
      message2 += `- Colonnine disponibili: ${stats.current_status.slots_available}/${stats.total_slots}\n`;
      message2 += `- Colonnine occupate: ${stats.current_status.slots_occupied}/${stats.total_slots}\n`;
      message2 += `- Utenti in coda: ${stats.current_status.queue_length}\n\n`;
      
      // Suggerimenti per altri comandi
      message2 += `ℹ️ *Altre informazioni*\n`;
      message2 += `- Stato dettagliato: /admin_status\n`;
      message2 += `- Controllo penalità: /admin_check_penalties`;
      
      // Invia il secondo messaggio
      await bot.sendMessage(chatId, message2, { parse_mode: 'Markdown' });
      
    } catch (error) {
      logger.error('Error in /admin_stats command:', error);
      bot.sendMessage(chatId, `❌ Errore: ${error.message}`);
    }
  }

  /**
   * Gestisce il comando dbtest
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   */
  async handleDbTest(bot, chatId) {
    try {
      const systemCount = await System.countDocuments();
      const sessionCount = await Session.countDocuments();
      const queueCount = await Queue.countDocuments();
      const userCount = await User.countDocuments();
      
      logger.info(`Database test results: System=${systemCount}, Session=${sessionCount}, Queue=${queueCount}, User=${userCount}`);
      
      bot.sendMessage(chatId, 
        `📊 *Stato Database:*\n` +
        `- System documents: *${systemCount}*\n` +
        `- Session documents: *${sessionCount}*\n` +
        `- Queue documents: *${queueCount}*\n` +
        `- User documents: *${userCount}*`, 
        { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error(`Error in /dbtest command:`, error);
      bot.sendMessage(chatId, `❌ Errore durante il test del database: ${error.message}`);
    }
  }
}

module.exports = new AdminCommands();
