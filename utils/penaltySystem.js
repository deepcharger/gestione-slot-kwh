/**
 * Sistema di gestione delle penalità
 * Gestisce l'assegnazione e la verifica delle penalità per gli utenti
 */
const User = require('../models/user');
const logger = require('./logger');
const formatters = require('./formatters');

class PenaltySystem {
  /**
   * Controlla l'idoneità di un utente in base alle sue penalità
   * @param {Number} userId - ID Telegram dell'utente
   * @returns {Promise<Object>} Oggetto con stato di idoneità e messaggio
   */
  async checkUserEligibility(userId) {
    try {
      // Ottieni l'utente dal database
      const user = await User.findOne({ telegram_id: userId });
      
      // Se l'utente non esiste, è idoneo
      if (!user) {
        return {
          eligible: true,
          message: null,
          user: null
        };
      }
      
      // Controlla ban scaduti
      if (user.temporarily_banned && user.ban_end_date) {
        const now = new Date();
        if (now > user.ban_end_date) {
          // Il ban è scaduto, rimuovilo
          user.temporarily_banned = false;
          user.ban_end_date = null;
          await user.save();
          
          return {
            eligible: true,
            message: `Il tuo ban temporaneo è terminato. Sei di nuovo autorizzato a utilizzare le colonnine di ricarica. Per favore, rispetta i tempi per evitare ulteriori penalità.`,
            user
          };
        } else {
          // L'utente è ancora bannato
          return {
            eligible: false,
            message: `Il tuo account è temporaneamente sospeso fino al ${this.formatDate(user.ban_end_date)} a causa di troppe penalità accumulate. Non puoi prenotare colonnine fino a quella data.`,
            user
          };
        }
      }
      
      // Controlla reset penalità dopo 30 giorni
      if (user.penalty_points > 0 && user.last_penalty_date) {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        if (user.last_penalty_date < thirtyDaysAgo) {
          // Le penalità sono scadute, azzera
          user.penalty_points = 0;
          await user.save();
          
          return {
            eligible: true,
            message: `I tuoi punti penalità sono stati azzerati poiché sono passati più di 30 giorni dall'ultima infrazione.`,
            user
          };
        }
        
        // Se ha penalità ma non è bannato, è comunque idoneo (con avviso)
        if (user.penalty_points >= 7) {
          return {
            eligible: true,
            message: `⚠️ Attenzione: hai ${user.penalty_points} punti penalità su 10. Al raggiungimento di 10 punti il tuo account sarà temporaneamente sospeso.`,
            user
          };
        }
      }
      
      // Utente idoneo
      return {
        eligible: true,
        message: null,
        user
      };
    } catch (error) {
      logger.error(`Error checking user eligibility for ${userId}:`, error);
      // In caso di errore, assumiamo che l'utente sia idoneo
      return {
        eligible: true,
        message: null,
        user: null
      };
    }
  }

  /**
   * Gestisce le penalità per ritardi eccessivi
   * @param {Number} userId - ID Telegram dell'utente
   * @param {String} sessionId - ID della sessione
   * @param {Number} overdueMinutes - Minuti di ritardo
   * @param {Object} bot - Istanza del bot Telegram (opzionale)
   * @param {Number} adminId - ID dell'admin per notifiche (opzionale)
   * @returns {Promise<Object>} Oggetto con esito dell'operazione
   */
  async handleExcessiveOvertime(userId, sessionId, overdueMinutes, bot = null, adminId = null) {
    try {
      // Se il ritardo è inferiore a 5 minuti, non applicare penalità
      if (overdueMinutes < 5) {
        return {
          applied: false,
          points: 0,
          banned: false,
          message: 'Nessuna penalità applicata: ritardo inferiore a 5 minuti'
        };
      }
      
      // Ottieni o crea l'utente
      let user = await User.findOne({ telegram_id: userId });
      
      if (!user) {
        logger.warn(`User ${userId} not found for penalty, creating`);
        user = new User({
          telegram_id: userId,
          username: `user${userId}`,
          first_interaction: new Date()
        });
      }
      
      // Determina i punti penalità in base al ritardo
      let penaltyPoints = 0;
      
      if (overdueMinutes >= 5 && overdueMinutes < 15) {
        // 5-15 minuti: 1 punto
        penaltyPoints = 1;
      } else if (overdueMinutes >= 15 && overdueMinutes < 30) {
        // 15-30 minuti: 2 punti
        penaltyPoints = 2;
      } else {
        // Oltre 30 minuti: 3 punti per ogni mezz'ora completa
        penaltyPoints = 3 * Math.ceil(overdueMinutes / 30);
      }
      
      // Monitora se le penalità sono già state applicate per questa sessione
      const sessionKey = sessionId.toString();
      
      if (!user.penalty_sessions) {
        user.penalty_sessions = {};
      }
      
      // Se la sessione è già stata penalizzata, applicare solo incrementi
      if (user.penalty_sessions[sessionKey]) {
        const previousPenalty = user.penalty_sessions[sessionKey];
        
        // Se la penalità attuale è maggiore della precedente, applica solo la differenza
        if (penaltyPoints > previousPenalty) {
          const additionalPoints = penaltyPoints - previousPenalty;
          user.penalty_points += additionalPoints;
          user.penalty_sessions[sessionKey] = penaltyPoints;
          
          logger.info(`Applied additional ${additionalPoints} penalty points to user ${userId} (total: ${user.penalty_points})`);
        } else {
          // Nessuna penalità addizionale
          return {
            applied: false,
            points: 0,
            banned: user.temporarily_banned,
            message: 'Nessuna penalità aggiuntiva applicata'
          };
        }
      } else {
        // Prima penalità per questa sessione
        user.penalty_points += penaltyPoints;
        user.penalty_sessions[sessionKey] = penaltyPoints;
        
        logger.info(`Applied ${penaltyPoints} penalty points to user ${userId} (total: ${user.penalty_points})`);
      }
      
      // Aggiorna la data dell'ultima penalità
      user.last_penalty_date = new Date();
      
      // Controlla se l'utente deve essere bannato (10+ punti)
      let newlyBanned = false;
      
      if (user.penalty_points >= 10 && !user.temporarily_banned) {
        user.temporarily_banned = true;
        
        // Ban di 7 giorni
        const banEndDate = new Date();
        banEndDate.setDate(banEndDate.getDate() + 7);
        user.ban_end_date = banEndDate;
        
        newlyBanned = true;
        
        logger.info(`User ${userId} banned until ${user.ban_end_date} for reaching ${user.penalty_points} penalty points`);
        
        // Notifica l'admin del ban
        if (adminId && bot) {
          try {
            await bot.sendMessage(
              adminId,
              `🚫 *Ban automatico applicato*\n\n` +
              `L'utente @${user.username} (${userId}) ha raggiunto ${user.penalty_points} punti penalità.\n` +
              `Account sospeso fino al ${this.formatDate(user.ban_end_date)}.`,
              { parse_mode: 'Markdown' }
            );
          } catch (err) {
            logger.error(`Error sending ban notification to admin:`, err);
          }
        }
      }
      
      // Salva le modifiche
      await user.save();
      
      // Notifica l'utente della penalità
      if (bot) {
        try {
          if (newlyBanned) {
            await bot.sendMessage(
              userId,
              `🚫 *Account temporaneamente sospeso*\n\n` +
              `Hai raggiunto ${user.penalty_points} punti penalità a causa di ripetuti ritardi.\n\n` +
              `Il tuo account è sospeso fino al ${this.formatDate(user.ban_end_date)}.\n` +
              `Non potrai utilizzare le colonnine di ricarica fino a quella data.\n\n` +
              `Per maggiori informazioni, usa il comando /stato_utente.`,
              { parse_mode: 'Markdown' }
            );
          } else if (penaltyPoints > 0) {
            await bot.sendMessage(
              userId,
              `⚠️ *Penalità applicata*\n\n` +
              `Ti sono stati assegnati ${penaltyPoints} punti penalità per un ritardo di ${overdueMinutes} minuti.\n\n` +
              `Hai ora un totale di ${user.penalty_points}/10 punti penalità.\n` +
              `Al raggiungimento di 10 punti il tuo account sarà temporaneamente sospeso.\n\n` +
              `Per maggiori informazioni, usa il comando /stato_utente.`,
              { parse_mode: 'Markdown' }
            );
          }
        } catch (err) {
          logger.error(`Error sending penalty notification to user:`, err);
        }
      }
      
      return {
        applied: true,
        points: penaltyPoints,
        banned: newlyBanned,
        message: newlyBanned ? 'Utente bannato per 7 giorni' : 'Penalità applicata'
      };
    } catch (error) {
      logger.error(`Error handling excessive overtime for user ${userId}:`, error);
      return {
        applied: false,
        points: 0,
        banned: false,
        message: 'Errore durante l\'applicazione delle penalità'
      };
    }
  }

  /**
   * Formatta una data in formato italiano
   * @param {Date} date - Data da formattare
   * @returns {String} - Data formattata
   */
  formatDate(date) {
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
}

module.exports = new PenaltySystem();
