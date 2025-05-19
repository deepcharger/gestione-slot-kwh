/**
 * Router di comandi per il bot Telegram
 * Centralizza la gestione dei comandi e li dispaccia agli handler specifici
 */
const config = require('../config');
const logger = require('../utils/logger');
const userHandler = require('./userHandler');
const queueHandler = require('./queueHandler');
const sessionHandler = require('./sessionHandler');
const formatters = require('../utils/formatters');
const adminCommands = require('./adminCommands');
const Queue = require('../models/queue');
const Session = require('../models/session');
const User = require('../models/user');

class CommandRouter {
  constructor() {
    // Mappa dei comandi utente con relativi handler
    this.userCommands = {
      'start': this.handleStart.bind(this),
      'prenota': this.handlePrenota.bind(this),
      'cancella': this.handleCancella.bind(this),
      'iniziato': this.handleIniziato.bind(this),
      'terminato': this.handleTerminato.bind(this),
      'status': this.handleStatus.bind(this),
      'stato_utente': this.handleStatoUtente.bind(this),
      'help': this.handleHelp.bind(this),
      'dove_sono': this.handleDoveSono.bind(this)
    };
    
    // Mappa dei comandi admin con relativi handler
    this.adminCommands = {
      'admin_status': adminCommands.handleAdminStatus.bind(adminCommands),
      'admin_stats': adminCommands.handleAdminStats.bind(adminCommands),
      'admin_check_penalties': adminCommands.handleCheckPenalties.bind(adminCommands),
      'admin_set_charge_time': adminCommands.handleSetChargeTime.bind(adminCommands),
      'admin_set_reminder_time': adminCommands.handleSetReminderTime.bind(adminCommands),
      'admin_set_max_slots': adminCommands.handleSetMaxSlots.bind(adminCommands),
      'admin_reset_slot': adminCommands.handleResetSlot.bind(adminCommands),
      'admin_remove_queue': adminCommands.handleRemoveQueue.bind(adminCommands),
      'admin_notify_all': adminCommands.handleNotifyAll.bind(adminCommands),
      'admin_reset_system': adminCommands.handleResetSystem.bind(adminCommands),
      'admin_confirm_reset': adminCommands.handleConfirmReset.bind(adminCommands),
      'admin_help': adminCommands.handleAdminHelp.bind(adminCommands),
      'admin_update_commands': adminCommands.handleUpdateCommands.bind(adminCommands),
      'dbtest': adminCommands.handleDbTest.bind(adminCommands)
    };
  }

  /**
   * Verifica se l'utente è autorizzato a utilizzare il bot
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   * @param {Number} userId - ID dell'utente
   * @param {String} username - Username dell'utente
   * @returns {Promise<Boolean>} - true se l'utente è autorizzato, false altrimenti
   */
  async isUserAuthorized(bot, chatId, userId, username) {
    // Se non è attiva la restrizione al gruppo o è un admin, è sempre autorizzato
    if (!config.RESTRICT_TO_GROUP || userId === config.ADMIN_USER_ID) {
      return true;
    }
    
    // Verifica se l'utente è membro del gruppo autorizzato
    try {
      // Ottieni lo stato dell'utente nel gruppo
      const chatMember = await bot.getChatMember(config.AUTHORIZED_GROUP_ID, userId);
      
      // Verifica se lo stato è valido (member, administrator o creator)
      if (['member', 'administrator', 'creator'].includes(chatMember.status)) {
        logger.info(`User ${username} (${userId}) is authorized as ${chatMember.status} in group ${config.AUTHORIZED_GROUP_ID}`);
        return true;
      } else {
        logger.warn(`User ${username} (${userId}) is not authorized. Status: ${chatMember.status}`);
        return false;
      }
    } catch (error) {
      // Se c'è un errore nella verifica, probabilmente l'utente non è nel gruppo
      logger.error(`Error checking authorization for user ${username} (${userId}):`, error);
      return false;
    }
  }

  /**
   * Invia un messaggio di accesso negato
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   * @param {String} username - Username dell'utente
   */
  sendUnauthorizedMessage(bot, chatId, username) {
    bot.sendMessage(chatId, 
      `⚠️ *Accesso non autorizzato*\n\n` +
      `Mi dispiace @${username}, ma per utilizzare questo bot devi essere un membro del gruppo autorizzato.\n\n` +
      `Contatta l'amministratore per maggiori informazioni.`,
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Gestisce un comando ricevuto
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Object} msg - Messaggio Telegram
   * @param {String} command - Comando da gestire (senza /)
   * @param {Array} args - Argomenti del comando
   */
  async routeCommand(bot, msg, command, args = []) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || `user${userId}`;
    
    logger.info(`Received /${command} command from user ${userId} (${username})`);
    
    try {
      // Verifica se è un comando admin
      if (command.startsWith('admin_') || command === 'dbtest') {
        // Verifica che l'utente sia admin
        if (userId !== config.ADMIN_USER_ID) {
          logger.warn(`User ${userId} tried to use admin command but is not admin`);
          bot.sendMessage(chatId, '🚫 Comando riservato agli amministratori.');
          return;
        }
        
        // Dispaccia il comando admin
        const adminHandler = this.adminCommands[command];
        if (adminHandler) {
          await adminHandler(bot, chatId, userId, username, msg, args);
        } else {
          bot.sendMessage(chatId, `❌ Comando admin non riconosciuto: /${command}`);
        }
      } else {
        // Verifica se l'utente è autorizzato
        const isAuthorized = await this.isUserAuthorized(bot, chatId, userId, username);
        if (!isAuthorized) {
          this.sendUnauthorizedMessage(bot, chatId, username);
          return;
        }
        
        // Dispaccia il comando utente
        const userHandler = this.userCommands[command];
        if (userHandler) {
          await userHandler(bot, chatId, userId, username, msg, args);
        } else {
          bot.sendMessage(chatId, `❌ Comando non riconosciuto: /${command}`);
        }
      }
    } catch (error) {
      logger.error(`Error handling /${command} command for user ${userId}:`, error);
      bot.sendMessage(chatId, `❌ Si è verificato un errore: ${error.message}`);
    }
  }

  /**
   * Gestisce il comando "start"
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   * @param {Number} userId - ID dell'utente
   * @param {String} username - Username dell'utente
   */
  async handleStart(bot, chatId, userId, username) {
    try {
      await userHandler.registerUser(userId, username);
      
      const welcomeMessage = formatters.formatWelcomeMessage(username, userId);
      bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
        
      logger.info(`Sent welcome message to user ${userId}`);
    } catch (error) {
      logger.error(`Error in /start command for user ${userId}:`, error);
      bot.sendMessage(chatId, '❌ Si è verificato un errore durante l\'avvio. Riprova più tardi.');
    }
  }

  /**
   * Gestisce il comando "prenota"
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   * @param {Number} userId - ID dell'utente
   * @param {String} username - Username dell'utente
   */
  async handlePrenota(bot, chatId, userId, username) {
    try {
      const result = await queueHandler.requestCharge(userId, username);
      
      // Se c'è un messaggio di avviso (ad esempio per penalità), mostralo prima
      if (result.warningMessage) {
        await bot.sendMessage(chatId, `ℹ️ *Nota*\n\n${result.warningMessage}`, { parse_mode: 'Markdown' });
      }
      
      if (result.slotAvailable) {
        logger.info(`Slot available for user ${userId}, sending instructions`);
        const availableMessage = formatters.formatSlotAvailableMessage(username, userId, config.MAX_CHARGE_TIME);
        bot.sendMessage(chatId, availableMessage, { parse_mode: 'Markdown' });
      } else {
        logger.info(`No slots available, user ${userId} added to queue at position ${result.position}`);
        const queueMessage = formatters.formatQueueMessage(username, userId, result.position);
        bot.sendMessage(chatId, queueMessage, { parse_mode: 'Markdown' });
      }
    } catch (error) {
      logger.error(`Error in /prenota command for user ${userId}:`, error);
      bot.sendMessage(chatId, `❌ Si è verificato un errore: ${error.message}`);
    }
  }

  /**
   * Gestisce il comando "cancella"
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   * @param {Number} userId - ID dell'utente
   * @param {String} username - Username dell'utente
   */
  async handleCancella(bot, chatId, userId, username) {
    try {
      // Verifica se l'utente è in coda
      const inQueue = await Queue.findOne({ telegram_id: userId });
      
      if (inQueue) {
        // Rimuovilo dalla coda
        const position = inQueue.position;
        await queueHandler.removeFromQueue(userId);
        
        logger.info(`User ${userId} (${username}) removed from queue at position ${position}`);
        
        // Invia conferma all'utente
        bot.sendMessage(chatId, 
          `✅ @${username}, sei stato rimosso dalla coda con successo.\n\n` +
          `Eri in posizione *#${position}*.\n\n` +
          `Se vorrai ricaricare in futuro, usa nuovamente /prenota.`,
          { parse_mode: 'Markdown' });
        
        return;
      }
      
      // Verifica se l'utente ha una sessione attiva
      const session = await Session.findOne({ 
        telegram_id: userId,
        status: 'active'
      });
      
      if (session) {
        bot.sendMessage(chatId, 
          `ℹ️ @${username}, hai una sessione di ricarica attiva.\n\n` +
          `Se vuoi terminare la ricarica, usa il comando /terminato.`,
          { parse_mode: 'Markdown' });
        return;
      }
      
      // Se non è né in coda né in sessione
      bot.sendMessage(chatId, 
        `ℹ️ @${username}, non sei attualmente in coda né hai una sessione attiva.\n\n` +
        `Per prenotare una ricarica, usa il comando /prenota.`,
        { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error(`Error in /cancella command for user ${userId}:`, error);
      bot.sendMessage(chatId, `❌ Si è verificato un errore: ${error.message}`);
    }
  }

  /**
   * Gestisce il comando "iniziato"
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   * @param {Number} userId - ID dell'utente
   * @param {String} username - Username dell'utente
   */
  async handleIniziato(bot, chatId, userId, username) {
    try {
      const session = await sessionHandler.startSession(userId, username);
      
      logger.info(`Session started for user ${userId}, slot ${session.slot_number}`);
      
      const message = formatters.formatSessionStartMessage(session);
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      
      // Aggiorna lo stato del sistema nel messaggio di stato per tutti
      const systemStatus = await queueHandler.getSystemStatus();
      bot.sendMessage(chatId, 
        `🔌 Attualmente occupati ${systemStatus.slots_occupied}/${systemStatus.total_slots} slot.`);
    } catch (error) {
      logger.error(`Error in /iniziato command for user ${userId}:`, error);
      bot.sendMessage(chatId, `❌ Si è verificato un errore: ${error.message}`);
    }
  }

  /**
   * Gestisce il comando "terminato"
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   * @param {Number} userId - ID dell'utente
   * @param {String} username - Username dell'utente
   */
  async handleTerminato(bot, chatId, userId, username) {
    try {
      const result = await sessionHandler.endSession(userId);
      
      logger.info(`Session ended for user ${userId}, duration: ${result.durationMinutes} minutes`);
      
      const message = formatters.formatSessionEndMessage(result);
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      
      // Aggiorna lo stato del sistema nel messaggio di stato per tutti
      const systemStatus = await queueHandler.getSystemStatus();
      bot.sendMessage(chatId, 
        `🔌 Attualmente occupati ${systemStatus.slots_occupied}/${systemStatus.total_slots} slot.`);
      
      // Notifica il prossimo utente in coda
      await queueHandler.notifyNextInQueue(bot);
    } catch (error) {
      logger.error(`Error in /terminato command for user ${userId}:`, error);
      bot.sendMessage(chatId, `❌ Si è verificato un errore: ${error.message}`);
    }
  }

  /**
   * Gestisce il comando "status"
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   * @param {Number} userId - ID dell'utente
   * @param {String} username - Username dell'utente
   */
  async handleStatus(bot, chatId, userId, username) {
    try {
      const status = await queueHandler.getSystemStatus();
      logger.info(`Retrieved system status, formatting message`);
      
      const message = formatters.formatStatusMessage(status);
      
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      logger.info(`Sent status message to user ${userId}`);
    } catch (error) {
      logger.error(`Error in /status command from user ${userId}:`, error);
      logger.error(error.stack);
      bot.sendMessage(chatId, `❌ Si è verificato un errore durante il recupero dello stato.`);
    }
  }

  /**
   * Gestisce il comando "stato_utente"
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   * @param {Number} userId - ID dell'utente
   * @param {String} username - Username dell'utente
   */
  async handleStatoUtente(bot, chatId, userId, username) {
    try {
      const userStatus = await userHandler.getUserStatus(userId);
      
      if (!userStatus.exists) {
        bot.sendMessage(chatId, userStatus.message);
        return;
      }
      
      bot.sendMessage(chatId, userStatus.message, { parse_mode: 'Markdown' });
      logger.info(`Sent user status to ${userId}`);
    } catch (error) {
      logger.error(`Error in /stato_utente command for user ${userId}:`, error);
      bot.sendMessage(chatId, `❌ Si è verificato un errore: ${error.message}`);
    }
  }

  /**
   * Gestisce il comando "help"
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   * @param {Number} userId - ID dell'utente
   * @param {String} username - Username dell'utente
   */
  async handleHelp(bot, chatId, userId, username) {
    try {
      // Verifica se l'utente è admin per mostrare i comandi admin
      const isAdmin = userId === config.ADMIN_USER_ID;
      const message = formatters.formatHelpMessage(isAdmin);
      
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      logger.info(`Sent help message to user ${userId}`);
    } catch (error) {
      logger.error(`Error in /help command from user ${userId}:`, error);
      bot.sendMessage(chatId, `❌ Si è verificato un errore: ${error.message}`);
    }
  }

  /**
   * Gestisce il comando "dove_sono"
   * @param {Object} bot - Istanza del bot Telegram
   * @param {Number} chatId - ID della chat
   * @param {Number} userId - ID dell'utente
   * @param {String} username - Username dell'utente
   * @param {Object} msg - Messaggio Telegram
   */
  async handleDoveSono(bot, chatId, userId, username, msg) {
    try {
      const chatType = msg.chat.type;
      const chatTitle = msg.chat.title || "Chat privata";
      
      logger.info(`Received /dove_sono command from user ${userId} in chat ${chatId} (${chatType})`);
      
      let message = `📍 *Informazioni sulla chat attuale*\n\n`;
      
      if (chatType === 'private') {
        message += `Tipo: Chat privata con il bot\n`;
        message += `ID: \`${chatId}\`\n\n`;
        message += `Questo è l'ID della tua chat privata con il bot, non di un gruppo.`;
      } else if (chatType === 'group' || chatType === 'supergroup') {
        message += `Tipo: ${chatType === 'supergroup' ? 'Supergruppo' : 'Gruppo'}\n`;
        message += `Nome: *${chatTitle}*\n`;
        message += `ID: \`${chatId}\`\n\n`;
        message += `🔍 Questo è l'ID di questo gruppo. Per configurare il bot per l'uso esclusivo in questo gruppo, ` +
                 `l'amministratore del bot dovrà impostare questo ID nella configurazione.`;
      } else {
        message += `Tipo: ${chatType}\n`;
        message += `ID: \`${chatId}\`\n`;
      }
      
      // Aggiungi info per gli admin
      if (userId === config.ADMIN_USER_ID) {
        message += `\n\n👑 *Info per l'amministratore:*\n`;
        message += `Per configurare il bot per l'uso esclusivo in questo gruppo, imposta le variabili d'ambiente:\n`;
        message += `\`AUTHORIZED_GROUP_ID=${chatId}\`\n`;
        message += `\`RESTRICT_TO_GROUP=true\``;
      }
      
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      logger.info(`Sent location info to user ${userId} for chat ${chatId}`);
    } catch (error) {
      logger.error(`Error in /dove_sono command for user ${userId}:`, error);
      bot.sendMessage(chatId, `❌ Si è verificato un errore: ${error.message}`);
    }
  }
}

module.exports = new CommandRouter();
