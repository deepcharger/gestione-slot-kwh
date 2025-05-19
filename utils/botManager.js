/**
 * Modulo per la gestione del bot Telegram
 * Responsabile dell'avvio, arresto e gestione degli eventi del bot
 */
const TelegramBot = require('node-telegram-bot-api');
const logger = require('./logger');
const config = require('../config');
const messageHandler = require('../handlers/messageHandler');
const { v4: uuidv4 } = require('uuid');

class BotManager {
  constructor(lockManager) {
    this.bot = null;
    this.lockManager = lockManager;
    this.isBotStarting = false;
    this.isPollingRestarting = false;
    this.telegramConflictDetected = false;
    this.lastTelegramConflictTime = null;
    this.pollingRetryCount = 0;
    this.networkErrorCount = 0;
    this.connectionFailureCount = 0;
    this.lastConnectionAttemptTime = 0;
    this.notificationSystem = null;
    
    // Costanti
    this.MAX_RETRY_COUNT = 10;
    this.MAX_NETWORK_ERROR_COUNT = 10;
    this.CONNECTION_ATTEMPT_COOLDOWN = 30000;
  }

  /**
   * Avvia il bot Telegram
   * @returns {Promise<boolean>} - true se l'avvio è riuscito
   */
  async startBot() {
    if (this.bot) return true; // Bot già avviato
    if (this.isBotStarting) return false; // Avvio già in corso
    
    // Imposta il flag di avvio
    this.isBotStarting = true;
    
    try {
      logger.info('Avvio del bot...');
      
      // Verifica se ci sono già conflitti Telegram
      const telegramStatus = await this.lockManager.testTelegramConnection();
      if (!telegramStatus) {
        logger.warn('Rilevato conflitto Telegram prima dell\'avvio del bot, attendiamo...');
        this.isBotStarting = false;
        setTimeout(() => this.startBot(), 45000 + Math.random() * 30000); // 45-75 secondi
        return false;
      }
      
      // Inizializzazione bot Telegram
      this.bot = new TelegramBot(config.BOT_TOKEN, { 
        polling: {
          interval: 5000, // Aumentato a 5 secondi
          timeout: 180, // Aumentato a 3 minuti
          limit: 50, // Ridotto per diminuire il carico
          retryTimeout: 30000, // 30 secondi
          autoStart: true
        },
        polling_error_timeout: 45000, // 45 secondi
        onlyFirstMatch: false,
        request: {
          timeout: 180000, // 3 minuti
          agentOptions: {
            keepAlive: true,
            keepAliveMsecs: 120000, // 2 minuti
            maxSockets: 25, // Ridotto per evitare troppi socket simultanei
            maxFreeSockets: 5,
            timeout: 180000 // 3 minuti
          }
        } 
      });
      
      // Configura gli handler di errore
      this.setupErrorHandlers();

      // Test della connessione a Telegram
      logger.info('Verifica connessione a Telegram...');
      const info = await this.bot.getMe();
      logger.info(`✅ Bot connesso correttamente come @${info.username} (ID: ${info.id})`);
      
      // Reset flag e contatori
      this.isBotStarting = false;
      this.pollingRetryCount = 0;
      this.telegramConflictDetected = false;
      this.networkErrorCount = 0;
      
      // Inizializza i comandi del bot
      try {
        await messageHandler.init(this.bot);
      } catch (err) {
        logger.error('Errore nell\'inizializzazione dell\'handler messaggi:', err);
      }
    
      logger.info('✅ Bot avviato con successo');
      logger.logMemoryUsage(); // Log dell'utilizzo memoria
      
      return true;
    } catch (error) {
      logger.error('❌ Errore critico durante l\'avvio del bot:', error);
      logger.error('Stack trace:', error.stack);
      
      // Reset flag di avvio
      this.isBotStarting = false;
      
      // Se il bot è stato creato, proviamo a fermarlo
      if (this.bot) {
        await this.stopBot();
      }
      
      return false;
    }
  }

  /**
   * Configura gli handler degli errori per il bot
   */
  setupErrorHandlers() {
    if (!this.bot) return;
    
    // Logging di eventi di polling
    this.bot.on('polling_error', (error) => {
      logger.error('❌ Errore di polling Telegram:', error);
      
      // Se l'errore è un conflitto (409), implementa un backoff esponenziale
      if (error.code === 'ETELEGRAM' && error.message && error.message.includes('409 Conflict')) {
        // Setta i flag di conflitto
        this.telegramConflictDetected = true;
        this.lastTelegramConflictTime = Date.now();
        
        logger.warn('Rilevato conflitto con altra istanza Telegram, gestione...');
        this.pollingRetryCount++;
        
        // Se abbiamo troppi tentativi falliti, meglio terminare
        if (this.pollingRetryCount > this.MAX_RETRY_COUNT) {
          logger.warn(`Troppi tentativi falliti (${this.pollingRetryCount}), terminazione...`);
          return;
        }
        
        // Calcola il tempo di backoff esponenziale (tra 5 e 60 secondi)
        const backoffTime = Math.min(5000 * Math.pow(2, this.pollingRetryCount) + Math.random() * 5000, 60000);
        logger.info(`Attesa di ${Math.round(backoffTime/1000)} secondi prima di riprovare (tentativo ${this.pollingRetryCount})...`);
        
        // Ferma il polling attuale
        this.stopBot().then(() => {
          // Riprova dopo il backoff
          setTimeout(() => {
            this.isBotStarting = false; // Reset del flag per permettere il riavvio
            this.startBot(); // Riavvia il bot
          }, backoffTime);
        });
        
        return;
      } 
      // Nuova gestione specifica per gli errori di timeout del socket
      else if (error.code === 'EFATAL' && error.message && 
               (error.message.includes('ESOCKETTIMEDOUT') || 
                error.message.includes('ETIMEDOUT') || 
                error.message.includes('ECONNRESET'))) {
        
        logger.warn(`Rilevato errore di connessione ${error.message}, tentativo di ripristino leggero...`);
        
        // Incrementa un contatore di errori di rete
        this.networkErrorCount = (this.networkErrorCount || 0) + 1;
        
        // Se ci sono troppi errori consecutivi, riavvia completamente
        if (this.networkErrorCount > this.MAX_NETWORK_ERROR_COUNT) {
          logger.warn(`Troppi errori di rete consecutivi (${this.networkErrorCount}), riavvio completo del bot...`);
          this.stopBot().then(() => {
            this.networkErrorCount = 0; // Reset del contatore
            setTimeout(() => {
              this.isBotStarting = false;
              this.startBot();
            }, 15000);
          });
          return;
        }
        
        // Per i primi errori, tenta solo un riavvio "leggero" del polling
        try {
          // Piccola pausa per far ripristinare le connessioni di rete
          setTimeout(async () => {
            if (this.bot && !this.isPollingRestarting) {
              await this.restartPolling();
            }
          }, 5000);
        } catch (err) {
          logger.error('Errore durante la gestione del timeout:', err);
        }
      }
      else if (error.code === 'EFATAL' || error.code === 'EPARSE' || error.code === 'ETELEGRAM') {
        // Per altri errori fatali, EPARSE o errori di Telegram, attendiamo un po' e ritentiamo
        logger.warn(`Errore ${error.code}, tentatvo di ripartire il bot...`);
        this.stopBot().then(() => {
          // Attesa prima di riprovare
          setTimeout(() => {
            this.isBotStarting = false;
            this.startBot();
          }, 15000);
        });
      }
    });
  }

  /**
   * Funzione per il riavvio "leggero" del polling di Telegram
   * @returns {Promise<boolean>} - true se il riavvio è stato effettuato con successo
   */
  async restartPolling() {
    // Evita riavvii simultanei
    if (this.isPollingRestarting) return false;
    this.isPollingRestarting = true;
    
    try {
      logger.info('Tentativo di riavvio leggero del polling Telegram...');
      
      if (!this.bot) {
        logger.warn('Bot non inizializzato, impossibile riavviare il polling');
        this.isPollingRestarting = false;
        return false;
      }
      
      // MODIFICATO: Rimuovi tutti i listener prima di fermare il polling
      this.bot.removeAllListeners('polling_error');
      
      // Ferma il polling con opzione cancel per forzare la chiusura
      await this.bot.stopPolling({ cancel: true });
      
      // Attendi un po' per assicurarsi che il polling sia completamente fermato
      await new Promise(resolve => setTimeout(resolve, 5000)); // Aumentato a 5 secondi
      
      // MODIFICATO: Verifica se ci sono conflitti prima di riavviare
      const telegramStatus = await this.lockManager.testTelegramConnection();
      if (!telegramStatus) {
        logger.warn('Rilevato possibile conflitto, attendo prima di riavviare polling');
        this.isPollingRestarting = false;
        
        // Riprova un riavvio completo
        setTimeout(() => {
          this.bot = null;
          this.isBotStarting = false;
          this.startBot();
        }, 15000); // Attendi 15 secondi
        
        return false;
      }
      
      // Avvia di nuovo il polling
      await this.bot.startPolling();
      
      // Aggiungi nuovamente gli handler
      this.setupErrorHandlers();
      
      logger.info('Polling Telegram riavviato con successo');
      this.isPollingRestarting = false;
      
      // Se il riavvio ha successo, diminuisci il contatore degli errori di rete
      if (this.networkErrorCount > 0) this.networkErrorCount--;
      
      return true;
    } catch (error) {
      logger.error('Errore durante il riavvio leggero del polling:', error);
      
      // Riprova con un approccio più drastico
      try {
        await this.stopBot();
        
        setTimeout(() => {
          this.isPollingRestarting = false;
          this.startBot();
        }, 15000); // Aumentato a 15 secondi
      } catch (err) {
        logger.error('Errore anche durante l\'arresto completo del bot:', err);
        this.isPollingRestarting = false;
      }
      
      return false;
    }
  }

  /**
   * Ferma il bot in modo sicuro
   * @returns {Promise<boolean>} - true se il bot è stato fermato con successo
   */
  async stopBot() {
    if (!this.bot) return true; // Se non c'è bot, nulla da fare
    
    try {
      // Ferma il sistema di notifiche
      if (this.notificationSystem && this.notificationSystem.stop) {
        this.notificationSystem.stop();
        this.notificationSystem = null;
        logger.info('Sistema di notifiche fermato');
      }
      
      // Ferma il polling del bot
      logger.info('Arresto polling Telegram...');
      
      // Rimuovi tutti i listener per evitare eventi durante lo shutdown
      this.bot.removeAllListeners();
      
      try {
        await this.bot.stopPolling({ cancel: true });
      } catch (err) {
        logger.error('Errore durante l\'arresto del polling:', err);
      }
      
      // Attendi un po' per assicurarsi che il polling sia completamente fermato
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Resetta il bot
      this.bot = null;
      
      // Resetta il contatore dei tentativi
      this.pollingRetryCount = 0;
      
      // Resetta il flag di avvio
      this.isBotStarting = false;
      
      // Resetta il flag di riavvio del polling
      this.isPollingRestarting = false;
      
      return true;
    } catch (error) {
      logger.error('Errore durante l\'arresto del bot:', error);
      this.bot = null; // Forza il reset del bot anche in caso di errore
      return false;
    }
  }

  /**
   * Imposta il sistema di notifiche
   * @param {Object} notificationSystem - Sistema di notifiche da utilizzare
   */
  setNotificationSystem(notificationSystem) {
    this.notificationSystem = notificationSystem;
  }

  /**
   * Ottiene l'istanza del bot
   * @returns {Object|null} - Istanza del bot o null se non inizializzato
   */
  getBot() {
    return this.bot;
  }

  /**
   * Rilascia immediatamente le risorse Telegram senza attendere
   * Usato principalmente durante SIGTERM o errori gravi
   * @returns {Promise<boolean>} true se le risorse sono state rilasciate
   */
  async emergencyReleaseTelegram() {
    try {
      // Elimina immediatamente il webhook se è impostato
      if (this.bot) {
        try {
          this.bot.removeAllListeners();
          await this.bot.stopPolling({ cancel: true });
        } catch (err) {
          // Ignora errori
        }
        this.bot = null;
      }
      
      // Forzare una piccola attesa per permettere all'API di Telegram di resettare
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      logger.info('Risorse Telegram rilasciate in emergenza');
      return true;
    } catch (error) {
      logger.error('Errore durante il rilascio di emergenza:', error);
      return false;
    }
  }
}

module.exports = BotManager;
