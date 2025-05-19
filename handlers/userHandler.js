const User = require('../models/user');
const config = require('../config');
const logger = require('../utils/logger');
const penaltySystem = require('../utils/penaltySystem');
const formatters = require('../utils/formatters');

/**
 * Registra un nuovo utente o aggiorna i dati di un utente esistente
 * @param {Number} userId - ID Telegram dell'utente
 * @param {String} username - Username Telegram dell'utente
 * @returns {Promise<Object>} - Oggetto utente creato o aggiornato
 */
async function registerUser(userId, username) {
  try {
    // Controlla se l'utente è già registrato
    let user = await User.findOne({ telegram_id: userId });
    
    if (user) {
      // Aggiorna lo username se è cambiato
      if (user.username !== username) {
        user.username = username;
        await user.save();
        logger.info(`Updated username for user ${userId} to ${username}`);
      }
    } else {
      // Crea un nuovo utente
      user = new User({
        telegram_id: userId,
        username: username,
        // Verifica se l'utente è un admin
        is_admin: userId === config.ADMIN_USER_ID
      });
      
      await user.save();
      logger.info(`New user registered: ${username} (${userId})`);
    }
    
    return user;
  } catch (error) {
    logger.error(`Error registering user ${userId}:`, error);
    throw error;
  }
}

/**
 * Ottiene i dati di un utente
 * @param {Number} userId - ID Telegram dell'utente
 * @returns {Promise<Object|null>} - Oggetto utente o null se non trovato
 */
async function getUser(userId) {
  try {
    return await User.findOne({ telegram_id: userId });
  } catch (error) {
    logger.error(`Error getting user ${userId}:`, error);
    throw error;
  }
}

/**
 * Verifica se un utente è un amministratore
 * @param {Number} userId - ID Telegram dell'utente
 * @returns {Promise<Boolean>} - true se l'utente è admin, false altrimenti
 */
async function isAdmin(userId) {
  try {
    const user = await getUser(userId);
    return user && user.is_admin;
  } catch (error) {
    logger.error(`Error checking admin status for user ${userId}:`, error);
    return false;
  }
}

/**
 * Aggiorna le statistiche dell'utente dopo una ricarica
 * @param {Number} userId - ID Telegram dell'utente
 * @param {Number} chargeDuration - Durata della ricarica in minuti
 * @returns {Promise<Object>} - Oggetto utente aggiornato
 */
async function updateUserStats(userId, chargeDuration) {
  try {
    const user = await getUser(userId);
    
    if (user) {
      user.total_charges += 1;
      user.total_time += chargeDuration;
      user.last_charge = new Date();
      
      await user.save();
      logger.info(`Updated stats for user ${userId}: ${chargeDuration} minutes`);
      
      return user;
    }
    
    throw new Error(`User ${userId} not found`);
  } catch (error) {
    logger.error(`Error updating stats for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Ottiene la lista degli utenti registrati
 * @param {Object} filter - Filtro per la query
 * @returns {Promise<Array>} - Array di utenti
 */
async function getUsers(filter = {}) {
  try {
    return await User.find(filter).sort({ username: 1 });
  } catch (error) {
    logger.error('Error getting users:', error);
    throw error;
  }
}

/**
 * Ottiene lo stato dell'utente (incluse le penalità)
 * @param {Number} userId - ID Telegram dell'utente
 * @returns {Promise<Object>} - Oggetto con stato utente
 */
async function getUserStatus(userId) {
  try {
    const user = await User.findOne({ telegram_id: userId });
    
    if (!user) {
      return { 
        exists: false,
        message: 'Utente non registrato. Usa /start per registrarti.'
      };
    }
    
    // Controlla ban scaduti
    if (user.temporarily_banned && user.ban_end_date) {
      if (new Date() > user.ban_end_date) {
        user.temporarily_banned = false;
        user.ban_end_date = null;
        await user.save();
      }
    }
    
    // Controlla reset penalità dopo 30 giorni
    if (user.penalty_points > 0 && user.last_penalty_date) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      if (user.last_penalty_date < thirtyDaysAgo) {
        user.penalty_points = 0;
        await user.save();
      }
    }
    
    const statusMessage = formatters.formatUserStatusMessage(user);
    
    return {
      exists: true,
      user,
      message: statusMessage
    };
  } catch (error) {
    logger.error(`Error getting user status for ${userId}:`, error);
    throw error;
  }
}

module.exports = {
  registerUser,
  getUser,
  isAdmin,
  updateUserStats,
  getUsers,
  getUserStatus
};
