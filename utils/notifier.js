/**
 * Sistema di notifiche
 * Gestisce le notifiche automatiche agli utenti in base allo stato delle sessioni
 */
const mongoose = require('mongoose');
const logger = require('./logger');
const config = require('../config');
const formatters = require('./formatters');
const penaltySystem = require('./penaltySystem');
const Session = require('../models/session');
const Queue = require('../models/queue');
const User = require('../models/user');
const queueHandler = require('../handlers/queueHandler');

/**
 * Avvia il sistema di notifiche periodiche
 * @param {Object} bot - Istanza del bot Telegram
 * @param {Function} executeWithLock - Funzione per eseguire operazioni con lock
 * @param {Function} isActiveInstance - Funzione per verificare se l'istanza è attiva
 * @returns {Object} - Riferimenti ai timer avviati
 */
function startNotificationSystem(bot, executeWithLock, isActiveInstance) {
  if (!bot) {
    logger.error('Impossibile avviare il sistema di notifiche: bot non fornito');
    return null;
  }
  
  // Ferma eventuali timer esistenti
  stopNotificationSystem();
  
  // Riferimenti ai timer attivi
  let reminderTimer = null;
  let timeoutTimer = null;
  let overdueTimer = null;
  let queueTimeoutTimer = null;
  
  // Timer per verificare le sessioni in scadenza (promemoria)
  reminderTimer = setInterval(async () => {
    try {
      // Se abbiamo una funzione per verificare l'istanza attiva, usiamola
      if (isActiveInstance && !(await isActiveInstance())) {
        logger.info('Non siamo l\'istanza attiva, salto il controllo delle sessioni in scadenza');
        return;
      }
      
      // Verifica che la connessione MongoDB sia attiva
      if (mongoose.connection.readyState !== 1) {
        logger.warn('Sistema di notifiche: MongoDB non connesso, skip controllo sessioni in scadenza');
        return;
      }
      
      if (executeWithLock) {
        await executeWithLock('check_expiring_sessions', async () => {
          await checkExpiringSessions(bot);
        });
      } else {
        await checkExpiringSessions(bot);
      }
    } catch (error) {
      logger.error('Errore durante il controllo delle sessioni in scadenza:', error);
    }
  }, 60000); // Controlla ogni minuto
  
  // Timer per verificare le sessioni scadute
  timeoutTimer = setInterval(async () => {
    try {
      // Se abbiamo una funzione per verificare l'istanza attiva, usiamola
      if (isActiveInstance && !(await isActiveInstance())) {
        logger.info('Non siamo l\'istanza attiva, salto il controllo delle sessioni scadute');
        return;
      }
      
      // Verifica che la connessione MongoDB sia attiva
      if (mongoose.connection.readyState !== 1) {
        logger.warn('Sistema di notifiche: MongoDB non connesso, skip controllo sessioni scadute');
        return;
      }
      
      if (executeWithLock) {
        await executeWithLock('check_expired_sessions', async () => {
          await checkExpiredSessions(bot);
        });
      } else {
        await checkExpiredSessions(bot);
      }
    } catch (error) {
      logger.error('Errore durante il controllo delle sessioni scadute:', error);
    }
  }, 60000); // Controlla ogni minuto
  
  // Timer per inviare promemoria periodici per le sessioni che hanno superato il limite
  overdueTimer = setInterval(async () => {
    try {
      // Se abbiamo una funzione per verificare l'istanza attiva, usiamola
      if (isActiveInstance && !(await isActiveInstance())) {
        logger.info('Non siamo l\'istanza attiva, salto il controllo delle sessioni in ritardo');
        return;
      }
      
      // Verifica che la connessione MongoDB sia attiva
      if (mongoose.connection.readyState !== 1) {
        logger.warn('Sistema di notifiche: MongoDB non connesso, skip controllo sessioni in ritardo');
        return;
      }
      
      if (executeWithLock) {
        await executeWithLock('check_overdue_sessions', async () => {
          await checkOverdueSessions(bot);
        });
      } else {
        await checkOverdueSessions(bot);
      }
    } catch (error) {
      logger.error('Errore durante il controllo delle sessioni in ritardo:', error);
    }
  }, 300000); // Controlla ogni 5 minuti
  
  // Timer per verificare gli utenti in coda che non hanno iniziato la ricarica
  queueTimeoutTimer = setInterval(async () => {
    try {
      // Se abbiamo una funzione per verificare l'istanza attiva, usiamola
      if (isActiveInstance && !(await isActiveInstance())) {
        logger.info('Non siamo l\'istanza attiva, salto il controllo timeout della coda');
        return;
      }
      
      // Verifica che la connessione MongoDB sia attiva
      if (mongoose.connection.readyState !== 1) {
        logger.warn('Sistema di notifiche: MongoDB non connesso, skip controllo timeout della coda');
        return;
      }
      
      if (executeWithLock) {
        await executeWithLock('check_queue_timeouts', async () => {
          await queueHandler.checkQueueTimeouts(bot);
        });
      } else {
        await queueHandler.checkQueueTimeouts(bot);
      }
    } catch (error) {
      logger.error('Errore durante il controllo dei timeout della coda:', error);
    }
  }, 60000); // Controlla ogni minuto
  
  logger.info('Sistema di notifiche avviato');
  
  return {
    reminderTimer,
    timeoutTimer,
    overdueTimer,
    queueTimeoutTimer,
    stop: () => {
      stopNotificationSystem(reminderTimer, timeoutTimer, overdueTimer, queueTimeoutTimer);
      return true;
    }
  };
}

/**
 * Ferma il sistema di notifiche
 * @param {Object} reminderTimer - Timer dei promemoria
 * @param {Object} timeoutTimer - Timer dei timeout
 * @param {Object} overdueTimer - Timer dei ritardi
 * @param {Object} queueTimeoutTimer - Timer dei timeout della coda
 */
function stopNotificationSystem(reminderTimer, timeoutTimer, overdueTimer, queueTimeoutTimer) {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
  
  if (timeoutTimer) {
    clearInterval(timeoutTimer);
    timeoutTimer = null;
  }
  
  if (overdueTimer) {
    clearInterval(overdueTimer);
    overdueTimer = null;
  }
  
  if (queueTimeoutTimer) {
    clearInterval(queueTimeoutTimer);
    queueTimeoutTimer = null;
  }
  
  logger.info('Sistema di notifiche fermato');
  return true;
}

/**
 * Controlla e notifica le sessioni in scadenza
 * @param {Object} bot - Istanza del bot Telegram
 * @returns {Promise<void>}
 */
async function checkExpiringSessions(bot) {
  try {
    if (!bot || !bot.sendMessage) {
      logger.warn('Bot non disponibile per inviare notifiche di scadenza');
      return;
    }
    
    // Verifica che la connessione MongoDB sia attiva
    if (mongoose.connection.readyState !== 1) {
      logger.warn('MongoDB non connesso, impossibile controllare sessioni in scadenza');
      return;
    }
    
    const now = new Date();
    const reminderThreshold = new Date(now.getTime() + config.REMINDER_TIME * 60000);
    
    // Trova sessioni che stanno per scadere e non hanno ancora ricevuto un promemoria
    const expiringSessions = await Session.find({
      status: 'active',
      reminded: false,
      end_time: { 
        $gt: now, 
        $lte: reminderThreshold 
      }
    });
    
    if (expiringSessions.length > 0) {
      logger.info(`Trovate ${expiringSessions.length} sessioni in scadenza da notificare`);
    }
    
    for (const session of expiringSessions) {
      try {
        // Calcola i minuti rimanenti
        const remainingMinutes = Math.max(
          0,
          Math.round((new Date(session.end_time) - now) / 60000)
        );
        
        // Genera il messaggio di promemoria
        const reminderMessage = formatters.formatReminderMessage(
          session.username, 
          remainingMinutes, 
          session.end_time,
          session.custom_duration // passa l'informazione se la durata è personalizzata
        );
        
        // Invia la notifica
        await bot.sendMessage(
          session.telegram_id,
          reminderMessage,
          { parse_mode: 'Markdown' }
        );
        
        // Marca la sessione come notificata
        session.reminded = true;
        await session.save();
        
        logger.info(`Inviato promemoria a ${session.username} (${session.telegram_id}) - ${remainingMinutes} minuti rimanenti`);
      } catch (err) {
        logger.error(`Errore nell'invio del promemoria a ${session.username}:`, err);
      }
    }
  } catch (error) {
    logger.error('Error checking expiring sessions:', error);
    throw error;
  }
}

/**
 * Controlla e notifica le sessioni scadute
 * @param {Object} bot - Istanza del bot Telegram
 * @returns {Promise<void>}
 */
async function checkExpiredSessions(bot) {
  try {
    if (!bot || !bot.sendMessage) {
      logger.warn('Bot non disponibile per inviare notifiche di timeout');
      return;
    }
    
    // Verifica che la connessione MongoDB sia attiva
    if (mongoose.connection.readyState !== 1) {
      logger.warn('MongoDB non connesso, impossibile controllare sessioni scadute');
      return;
    }
    
    const now = new Date();
    
    // Trova sessioni scadute che non hanno ancora ricevuto una notifica di timeout
    const expiredSessions = await Session.find({
      status: 'active',
      timeout_notified: false,
      end_time: { $lte: now }
    });
    
    if (expiredSessions.length > 0) {
      logger.info(`Trovate ${expiredSessions.length} sessioni scadute da notificare`);
    }
    
    for (const session of expiredSessions) {
      try {
        // Ottieni la durata effettiva dalla sessione
        const chargeDuration = session.duration_minutes || config.MAX_CHARGE_TIME;
        
        // Genera il messaggio di timeout
        const timeoutMessage = formatters.formatTimeoutMessage(
          session.username, 
          chargeDuration,
          session.custom_duration // passa l'informazione se la durata è personalizzata
        );
        
        // Invia la notifica
        await bot.sendMessage(
          session.telegram_id,
          timeoutMessage,
          { parse_mode: 'Markdown' }
        );
        
        // Marca la sessione come notificata per il timeout
        session.timeout_notified = true;
        await session.save();
        
        logger.info(`Inviata notifica di timeout a ${session.username} (${session.telegram_id})`);
      } catch (err) {
        logger.error(`Errore nell'invio della notifica di timeout a ${session.username}:`, err);
      }
    }
  } catch (error) {
    logger.error('Error checking expired sessions:', error);
    throw error;
  }
}

/**
 * Controlla e invia promemoria per le sessioni in ritardo (oltre il limite)
 * @param {Object} bot - Istanza del bot Telegram
 * @returns {Promise<void>}
 */
async function checkOverdueSessions(bot) {
  try {
    if (!bot || !bot.sendMessage) {
      logger.warn('Bot non disponibile per inviare notifiche di ritardo');
      return;
    }
    
    // Verifica che la connessione MongoDB sia attiva
    if (mongoose.connection.readyState !== 1) {
      logger.warn('MongoDB non connesso, impossibile controllare sessioni in ritardo');
      return;
    }
    
    const now = new Date();
    
    // Trova sessioni che sono scadute, hanno già ricevuto una notifica di timeout,
    // ma sono ancora attive (l'utente non ha confermato la fine)
    const overdueSessionsResult = await Session.find({
      status: 'active',
      timeout_notified: true,
      end_time: { $lt: now }
    });
    
    // Filtra per includere solo quelle con un ritardo significativo (più di 5 minuti)
    const overdueThreshold = new Date(now.getTime() - 5 * 60000); // 5 minuti fa
    const overdueSessions = overdueSessionsResult.filter(session => 
      new Date(session.end_time) < overdueThreshold
    );
    
    if (overdueSessions.length > 0) {
      logger.info(`Trovate ${overdueSessions.length} sessioni in ritardo da notificare`);
    }
    
    for (const session of overdueSessions) {
      try {
        // Calcola i minuti di ritardo
        const overdueMinutes = Math.round((now - new Date(session.end_time)) / 60000);
        
        if (overdueMinutes >= 5) {
          // Genera un messaggio progressivamente più severo in base al ritardo
          const message = formatters.formatOvertimeMessage(session.username, overdueMinutes);
          
          // Invia la notifica
          await bot.sendMessage(session.telegram_id, message, { parse_mode: 'Markdown' });
          
          logger.info(`Inviato promemoria di ritardo a ${session.username} (${session.telegram_id}) - ${overdueMinutes} minuti di ritardo`);
          
          // Applica penalità per ritardi eccessivi
          await penaltySystem.handleExcessiveOvertime(
            session.telegram_id, 
            session._id, 
            overdueMinutes, 
            bot, 
            config.ADMIN_USER_ID
          );
          
          // Notifica anche all'admin per ritardi gravi (ogni 30 minuti)
          if (config.ADMIN_USER_ID && overdueMinutes >= 30 && overdueMinutes % 30 === 0) {
            // Informazioni sulla durata personalizzata
            const durationInfo = session.custom_duration 
              ? `(durata personalizzata: ${session.duration_minutes} minuti)` 
              : `(durata predefinita: ${config.MAX_CHARGE_TIME} minuti)`;
            
            await bot.sendMessage(
              config.ADMIN_USER_ID,
              `🚨 *Segnalazione ritardo grave*\n\n` +
              `L'utente @${session.username} sta occupando lo slot ${session.slot_number} da *${overdueMinutes} minuti* oltre il tempo massimo ${durationInfo}.`,
              { parse_mode: 'Markdown' }
            );
          }
        }
      } catch (err) {
        logger.error(`Errore nell'invio del promemoria di ritardo a ${session.username}:`, err);
      }
    }
  } catch (error) {
    logger.error('Error checking overdue sessions:', error);
    throw error;
  }
}

module.exports = {
  startNotificationSystem,
  stopNotificationSystem,
  checkExpiringSessions,
  checkExpiredSessions,
  checkOverdueSessions
};
