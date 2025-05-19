/**
 * Gestore dei messaggi del bot
 * Punto di ingresso principale per gestire i messaggi ricevuti dal bot
 */
const config = require('../config');
const logger = require('../utils/logger');
const commandRouter = require('./commandRouter');

/**
 * Inizializza la gestione dei messaggi e comandi
 * @param {Object} bot - Istanza del bot Telegram
 */
function init(bot) {
  // Verifica connessione a Telegram
  try {
    logger.info('Testing Telegram connection...');
    bot.getMe().then(async info => {
      logger.info(`Connected to Telegram as @${info.username}`);
      
      // Imposta i comandi del bot e attendi il completamento
      try {
        const adminCommands = require('./adminCommands');
        await adminCommands.setupBotCommands(bot);
      } catch (err) {
        logger.error('Error setting up bot commands:', err);
      }
    }).catch(err => {
      logger.error('Failed to connect to Telegram:', err);
    });
  } catch (error) {
    logger.error('Error during Telegram connection test:', error);
  }

  // Gestione comandi generici con pattern /{comando}
  bot.onText(/\/([a-zA-Z0-9_]+)(?:@\w+)?(?:\s+(.*))?/, async (msg, match) => {
    const command = match[1].toLowerCase();
    const args = match[2] ? match[2].split(' ').filter(arg => arg.length > 0) : [];
    
    await commandRouter.routeCommand(bot, msg, command, args);
  });

  logger.info('Message handlers initialized');
}

module.exports = { init };
