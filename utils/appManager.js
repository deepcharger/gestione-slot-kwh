/**
 * Modulo per la gestione dell'applicazione
 * Responsabile dell'orchestrazione dei vari moduli e del ciclo di vita dell'applicazione
 */
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('./logger');
const BotManager = require('./botManager');
const LockManager = require('./lockManager');
const InstanceTracker = require('./instanceTracker');
const notifier = require('./notifier');
const LocalLockManager = require('./localLockManager');
const StartupNotification = require('../models/startupNotification');

// Timeout per la terminazione (ms)
const SHUTDOWN_TIMEOUT = 15000; // 15 secondi per dare più tempo

class AppManager {
  constructor() {
    // Genera un ID univoco per questa istanza dell'applicazione
    this.instanceId = `instance_${Date.now()}_${uuidv4().split('-')[0]}`;
    this.localLockManager = new LocalLockManager(this.instanceId);
    this.instanceTracker = new InstanceTracker(this.instanceId);
    
    // Inizializza il lock manager
    this.lockManager = new LockManager(this.instanceId);
    
    // Inizializza il bot manager
    this.botManager = new BotManager(this.lockManager);
    
    // Intervalli e timer
    this.masterLockHeartbeatInterval = null;
    this.executionLockHeartbeatInterval = null;
    this.lockCheckInterval = null;
    this.keepAliveInterval = null;
    
    // Flag per lo stato dell'applicazione
    this.isShuttingDown = false;
    this.lastHeartbeatTime = Date.now();
    this.notificationSystem = null;
    
    // Contatori per backoff e tentativi
    this.connectionFailureCount = 0;
    this.lastConnectionAttemptTime = 0;
    
    // Delay per l'inizializzazione
    this.MIN_INITIAL_DELAY = 20000; // 20 secondi
    this.MAX_INITIAL_DELAY = 40000; // 40 secondi
    this.CONNECTION_ATTEMPT_COOLDOWN = 30000; // 30 secondi min tra i tentativi di connessione
  }

  /**
   * Inizializza l'applicazione
   * @returns {Promise<boolean>} true se l'inizializzazione è riuscita
   */
  async initialize() {
    try {
      // Logging all'avvio
      logger.info('====== AVVIO BOT SLOTMANAGER ======');
      logger.info(`Versione Node: ${process.version}`);
      logger.info(`Versione mongoose: ${mongoose.version}`);
      logger.info(`ID Istanza: ${this.instanceId}`);
      logger.info(`Bot token length: ${config.BOT_TOKEN ? config.BOT_TOKEN.length : 'undefined'}`);
      logger.info(`MongoDB URI: ${config.MONGODB_URI ? 'Configurato' : 'Non configurato'}`);
      logger.info(`Admin user ID: ${config.ADMIN_USER_ID || 'Non configurato'}`);
      logger.info(`Environment: ${config.ENVIRONMENT}`);
      logger.info(`MAX_SLOTS: ${config.MAX_SLOTS}`);
      logger.info(`MAX_CHARGE_TIME: ${config.MAX_CHARGE_TIME}`);
      logger.info(`REMINDER_TIME: ${config.REMINDER_TIME}`);
      
      // Opzioni per la connessione MongoDB per maggiore resilienza
      const mongooseOptions = {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 15000, // 15 secondi per timeout di selezione server
        socketTimeoutMS: 60000, // 60 secondi per timeout socket
        family: 4, // Usa IPv4, evita problemi con IPv6
        // Questi parametri migliorano la stabilità della connessione
        connectTimeoutMS: 30000, // 30 secondi per timeout di connessione
        heartbeatFrequencyMS: 10000, // Heartbeat ogni 10 secondi
        retryWrites: true,
        maxPoolSize: 20, // 20 connessioni massime nel pool
        minPoolSize: 5  // 5 connessioni minime nel pool
      };
      
      // Registra eventi per MongoDB
      this.setupMongoDBEventHandlers();
      
      // Connessione a MongoDB
      logger.info('Tentativo di connessione a MongoDB...');
      await mongoose.connect(config.MONGODB_URI, mongooseOptions);
      logger.info('✅ Connessione a MongoDB riuscita');
      
      // Inizializza i moduli
      await this.lockManager.initialize();
      
      // Avvia la sequenza di inizializzazione
      await this.startInitializationSequence();
      
      return true;
    } catch (error) {
      logger.error('❌ Errore critico durante l\'inizializzazione:', error);
      
      if (error.name === 'MongoNetworkError') {
        logger.error(`Errore di connessione a MongoDB: ${error.message}`);
        logger.error(`URI MongoDB: ${config.MONGODB_URI ? config.MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//****:****@') : 'undefined'}`);
      }
      
      return false;
    }
  }

  /**
   * Configura gli handler degli eventi per MongoDB
   */
  setupMongoDBEventHandlers() {
    mongoose.connection.on('connecting', () => {
      logger.info('MongoDB: tentativo di connessione in corso...');
    });

    mongoose.connection.on('connected', () => {
      logger.info('MongoDB: connesso con successo');
    });

    mongoose.connection.on('disconnected', () => {
      if (!this.isShuttingDown) {
        logger.warn('MongoDB: disconnesso');
        logger.info('MongoDB: tentativo di riconnessione...');
      }
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB: riconnesso con successo');
    });

    mongoose.connection.on('error', (err) => {
      logger.error(`MongoDB: errore di connessione: ${err.message}`);
      if (err.name === 'MongoNetworkError' && !this.isShuttingDown) {
        logger.info('MongoDB: tentativo di riconnessione automatica...');
      }
    });
  }

  /**
   * Avvia la sequenza di inizializzazione
   */
  async startInitializationSequence() {
    try {
      // Attendi un periodo casuale prima di tentare di acquisire il master lock
      // Aumenta il ritardo per ridurre i conflitti durante i deploy
      const delayMs = this.MIN_INITIAL_DELAY + Math.floor(Math.random() * (this.MAX_INITIAL_DELAY - this.MIN_INITIAL_DELAY));
      logger.info(`Attesa di ${delayMs}ms prima di tentare di acquisire il master lock...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      
      // Prima di procedere, verifica lo stato globale
      const canProceed = await this.checkGlobalConnectionState();
      if (!canProceed) {
        logger.warn('Rilevate altre istanze attive, attesa aggiuntiva prima di procedere...');
        await new Promise(resolve => setTimeout(resolve, 15000 + Math.random() * 15000));
      }
      
      // Tenta di acquisire il master lock
      await this.acquireMasterLock();
    } catch (error) {
      logger.error('❌ Errore critico durante la sequenza di inizializzazione:', error);
      await this.performShutdown('INIT_ERROR');
    }
  }

  /**
   * Controlla lo stato globale della connessione
   * @returns {Promise<boolean>} true se non ci sono connessioni attive
   */
  async checkGlobalConnectionState() {
    try {
      // Pulisci i lock scaduti
      await this.lockManager.cleanupExpiredTaskLocks();
      
      // Verifica la presenza di lock attivi nel DB
      const activeLocks = await mongoose.models.Lock.find({
        lock_type: 'execution',
        last_heartbeat: { $gt: new Date(Date.now() - 180000) }
      });
      
      // Se non ci sono lock attivi, probabilmente non ci sono istanze attive
      if (activeLocks.length === 0) {
        logger.info('Nessun lock attivo rilevato nel DB, probabilmente non ci sono istanze attive');
        return true;
      }
      
      // Verifica se il lock appartiene a questa istanza
      const ownLock = activeLocks.find(lock => lock.instance_id === this.instanceId);
      if (ownLock) {
        logger.info('Lock attivo appartiene a questa istanza');
        return true;
      }

      // Se ci sono lock di altre istanze, attendiamo
      logger.warn(`Rilevati ${activeLocks.length} lock attivi di altre istanze, meglio attendere`);
      return false;
    } catch (error) {
      logger.error('Errore nel controllo dello stato globale:', error);
      // In caso di errore, assumiamo che sia meglio attendere
      return false;
    }
  }

  /**
   * Tenta di acquisire il master lock
   */
  async acquireMasterLock() {
    if (this.isShuttingDown) return; // Non tentare di acquisire il lock se lo shutdown è in corso
    
    try {
      // Tenta di acquisire il master lock
      const success = await this.lockManager.acquireMasterLock();
      
      if (success) {
        // Avvia il heartbeat per il master lock
        this.startMasterLockHeartbeat();
        
        // Procedi con l'acquisizione del lock di esecuzione
        await this.acquireExecutionLock();
      } else {
        // In caso di fallimento, riprova dopo 30 secondi
        setTimeout(() => {
          if (!this.isShuttingDown) {
            this.acquireMasterLock();
          }
        }, 30000);
      }
    } catch (error) {
      logger.error(`Errore durante l'acquisizione del master lock:`, error);
      // In caso di errore, riprova dopo 20 secondi
      if (!this.isShuttingDown) {
        setTimeout(() => this.acquireMasterLock(), 20000);
      }
    }
  }

  /**
   * Tenta di acquisire il lock di esecuzione
   */
  async acquireExecutionLock() {
    if (this.isShuttingDown) return; // Non tentare di acquisire il lock se lo shutdown è in corso
    
    try {
      // Limita la frequenza dei tentativi
      const now = Date.now();
      const timeSinceLastAttempt = now - this.lastConnectionAttemptTime;
      
      if (timeSinceLastAttempt < this.CONNECTION_ATTEMPT_COOLDOWN) {
        const waitTime = this.CONNECTION_ATTEMPT_COOLDOWN - timeSinceLastAttempt;
        logger.info(`Tentativo recente (${Math.round(timeSinceLastAttempt/1000)}s fa), attendere altri ${Math.round(waitTime/1000)}s`);
        
        // Pianifica un nuovo tentativo dopo il cooldown
        setTimeout(() => {
          if (!this.isShuttingDown) this.acquireExecutionLock();
        }, waitTime + Math.random() * 5000);
        return;
      }
      
      this.lastConnectionAttemptTime = now;
      
      // Tenta di acquisire il lock di esecuzione
      const success = await this.lockManager.acquireExecutionLock();
      
      if (success) {
        // Avvia il heartbeat per il lock di esecuzione
        this.startExecutionLockHeartbeat();
        
        // Avvia il controllo periodico del lock
        this.startLockCheck();
        
        // Attendi un po' prima di avviare il bot per sicurezza
        setTimeout(() => {
          // Avvia il bot
          this.startBot();
        }, 5000);
      } else {
        // In caso di fallimento, riprova dopo un po'
        setTimeout(() => {
          if (!this.isShuttingDown) {
            this.acquireExecutionLock();
          }
        }, 20000);
      }
    } catch (error) {
      logger.error(`Errore durante l'acquisizione del lock di esecuzione:`, error);
      // In caso di errore, riprova dopo 15 secondi
      if (!this.isShuttingDown) {
        setTimeout(() => this.acquireExecutionLock(), 15000);
      }
    }
  }

  /**
   * Avvia un interval per aggiornare periodicamente il master lock
   */
  startMasterLockHeartbeat() {
    if (this.masterLockHeartbeatInterval) {
      clearInterval(this.masterLockHeartbeatInterval);
    }
    
    this.masterLockHeartbeatInterval = setInterval(async () => {
      if (this.isShuttingDown) return; // Non aggiornare il lock durante lo shutdown
      
      try {
        const success = await this.lockManager.updateMasterLockHeartbeat();
        
        if (!success) {
          // Se non è stato possibile aggiornare il lock
          clearInterval(this.masterLockHeartbeatInterval);
          this.masterLockHeartbeatInterval = null;
          
          // Tenta di riacquisire il master lock
          if (!this.isShuttingDown) {
            setTimeout(() => this.acquireMasterLock(), 5000);
          }
        }
      } catch (error) {
        logger.error(`Errore durante l'aggiornamento del master lock:`, error);
      }
    }, 15000); // Aggiorna ogni 15 secondi
  }

  /**
   * Avvia un interval per aggiornare periodicamente il lock di esecuzione
   */
  startExecutionLockHeartbeat() {
    if (this.executionLockHeartbeatInterval) {
      clearInterval(this.executionLockHeartbeatInterval);
    }
    
    this.executionLockHeartbeatInterval = setInterval(async () => {
      if (this.isShuttingDown) return; // Non aggiornare il lock durante lo shutdown
      
      try {
        // Prima pulisci eventuali lock di test obsoleti per prevenire problemi
        await this.lockManager.cleanupTelegramTestLocks();
        
        const success = await this.lockManager.updateExecutionLockHeartbeat();
        
        if (success) {
          this.lastHeartbeatTime = Date.now();
        } else {
          // Se non è stato possibile aggiornare il lock, prova a riacquisirlo
          clearInterval(this.executionLockHeartbeatInterval);
          this.executionLockHeartbeatInterval = null;
          
          // Se il bot è in esecuzione, fermalo in modo sicuro
          if (this.botManager.getBot()) {
            try {
              await this.botManager.stopBot();
              logger.info(`Bot fermato per perdita del lock di esecuzione`);
            } catch (err) {
              logger.error(`Errore durante l'arresto del bot:`, err);
            }
          }
          
          // Attendi un po' prima di tentare di riacquisire il lock
          setTimeout(async () => {
            if (!this.isShuttingDown) {
              // Pulisci eventuali lock obsoleti prima di riprovare
              await this.lockManager.cleanupTelegramTestLocks();
              
              // Tenta di riacquisire il lock di esecuzione
              setTimeout(() => this.acquireExecutionLock(), 5000 + Math.random() * 5000);
            }
          }, 5000);
        }
      } catch (error) {
        logger.error(`Errore durante l'aggiornamento del lock di esecuzione:`, error);
      }
    }, 10000); // Aggiorna ogni 10 secondi
  }

  /**
   * Avvia un interval per controllare periodicamente lo stato dei lock
   */
  startLockCheck() {
    if (this.lockCheckInterval) {
      clearInterval(this.lockCheckInterval);
    }
    
    this.lockCheckInterval = setInterval(async () => {
      if (this.isShuttingDown) return; // Non controllare i lock durante lo shutdown
      
      try {
        // Verifica se il lock è stato aggiornato di recente (negli ultimi 30 secondi)
        const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeatTime;
        if (timeSinceLastHeartbeat > 30000) {
          logger.warn(`Nessun heartbeat per il lock di esecuzione negli ultimi ${Math.round(timeSinceLastHeartbeat/1000)}s, possibile problema`);
        }
        
        // Pulisci i task lock scaduti
        await this.lockManager.cleanupExpiredTaskLocks();
        
        // Verifica lo stato dei lock locali
        const localLocksValid = await this.lockManager.checkLocalLocks();
        if (!localLocksValid) {
          logger.warn('Lock locali non validi, possibile problema');
        }
        
        // Verifica la presenza di conflitti con altre istanze
        const noConflicts = await this.lockManager.checkForInstanceConflicts();
        if (!noConflicts && !this.isShuttingDown) {
          logger.warn('Rilevati conflitti con altre istanze, avvio shutdown preventivo');
          await this.performShutdown('CONFLICT_AVOIDANCE');
        }
      } catch (error) {
        logger.error(`Errore durante il controllo dei lock:`, error);
      }
    }, 30000); // Controlla ogni 30 secondi
  }

  /**
   * Avvia il bot
   */
  async startBot() {
    try {
      // Avvia il bot Telegram
      const success = await this.botManager.startBot();
      
      if (success) {
        // Controlla se è stata inviata una notifica di avvio nelle ultime 2 ore
        const recentlyNotified = await this.checkLastStartupNotification();
        
        // Se non c'è stata una notifica recente e l'admin è configurato, invia il messaggio
        if (!recentlyNotified && config.ADMIN_USER_ID) {
          logger.info(`Tentativo di invio messaggio di avvio all'admin ${config.ADMIN_USER_ID}...`);
          
          const bot = this.botManager.getBot();
          if (bot) {
            try {
              await bot.sendMessage(config.ADMIN_USER_ID, 
                `🔋 *SlotManager Bot avviato*\n\n` +
                `Il bot è ora online e pronto all'uso.\n\n` +
                `Versione: 1.6.0\n` +
                `Avviato: ${new Date().toLocaleString('it-IT')}\n` +
                `ID Istanza: ${this.instanceId}`,
                { parse_mode: 'Markdown' });
              
              logger.info('✅ Messaggio di avvio inviato all\'admin');
              
              // Salva il timestamp della notifica
              await this.saveStartupNotification('startup', 'Bot avviato con successo');
            } catch (err) {
              logger.warn('⚠️ Impossibile inviare messaggio all\'admin:', err.message);
            }
          }
        } else {
          logger.info('Notifica di avvio recente, messaggio non inviato');
        }
        
        // Avvio sistema di notifiche periodiche
        logger.info('Avvio sistema di notifiche...');
        try {
          // Ferma eventuali sistemi di notifiche precedenti
          if (this.notificationSystem && this.notificationSystem.stop) {
            this.notificationSystem.stop();
          }
          
          this.notificationSystem = notifier.startNotificationSystem(
            this.botManager.getBot(),
            (taskName, taskFunction, timeoutMs) => this.lockManager.executeWithLock(taskName, taskFunction, timeoutMs),
            () => this.lockManager.isActiveInstance()
          );
          
          // Passa il riferimento al botManager
          this.botManager.setNotificationSystem(this.notificationSystem);
          
          logger.info('✅ Sistema di notifiche avviato correttamente');
        } catch (err) {
          logger.error('Errore nell\'avvio del sistema di notifiche:', err);
        }
      }
    } catch (error) {
      logger.error('Errore durante l\'avvio del bot:', error);
    }
  }

  /**
   * Controlla se è stato inviato un messaggio di notifica di avvio recentemente
   * @returns {Promise<boolean>} - true se è stata inviata una notifica nelle ultime 2 ore
   */
  async checkLastStartupNotification() {
    try {
      // Cerca notifiche nelle ultime 2 ore
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const recentNotification = await StartupNotification.findOne({
        timestamp: { $gt: twoHoursAgo },
        notification_type: 'startup'
      });
      
      return !!recentNotification;
    } catch (error) {
      logger.error('Errore nel controllo delle notifiche di avvio:', error);
      // In caso di errore, assumiamo che non ci siano notifiche recenti
      return false;
    }
  }

  /**
   * Salva un record per la notifica di avvio
   * @param {string} type - Tipo di notifica ('startup', 'shutdown', 'error')
   * @param {string} message - Messaggio associato alla notifica
   */
  async saveStartupNotification(type = 'startup', message = '') {
    try {
      // Crea un nuovo record di notifica
      const notification = new StartupNotification({
        instance_id: this.instanceId,
        notification_type: type,
        message: message
      });
      
      await notification.save();
      logger.info(`Notifica di ${type} salvata`);
    } catch (error) {
      logger.error(`Errore nel salvataggio della notifica di ${type}:`, error);
    }
  }

  /**
   * Esegue lo shutdown dell'applicazione
   * @param {string} reason - Motivo dello shutdown
   */
  async performShutdown(reason = 'UNKNOWN') {
    if (this.isShuttingDown) return; // Evita shutdown multipli
    
    this.isShuttingDown = true;
    this.instanceTracker.startTermination(reason);
    
    logger.info(`Avvio procedura di shutdown (motivo: ${reason})`);
    
    try {
      // Salva una notifica di shutdown
      await this.saveStartupNotification('shutdown', `Shutdown avviato: ${reason}`);
      
      // Ferma il sistema di notifiche
      if (this.notificationSystem && this.notificationSystem.stop) {
        this.notificationSystem.stop();
        this.notificationSystem = null;
      }
      
      // Ferma gli intervalli
      if (this.masterLockHeartbeatInterval) {
        clearInterval(this.masterLockHeartbeatInterval);
        this.masterLockHeartbeatInterval = null;
      }
      
      if (this.executionLockHeartbeatInterval) {
        clearInterval(this.executionLockHeartbeatInterval);
        this.executionLockHeartbeatInterval = null;
      }
      
      if (this.lockCheckInterval) {
        clearInterval(this.lockCheckInterval);
        this.lockCheckInterval = null;
      }
      
      if (this.keepAliveInterval) {
        clearInterval(this.keepAliveInterval);
        this.keepAliveInterval = null;
      }
      
      // Ferma il bot
      if (this.botManager) {
        await this.botManager.stopBot();
      }
      
      // Rilascia le risorse Telegram in emergenza
      await this.botManager.emergencyReleaseTelegram();
      
      // Rilascia tutti i lock
      await this.lockManager.releaseAllLocks();
      
      logger.info(`Shutdown completato (motivo: ${reason})`);
      
      // Chiudi la connessione MongoDB
      if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
        logger.info('Connessione MongoDB chiusa');
      }
      
      return true;
    } catch (error) {
      logger.error(`Errore durante lo shutdown:`, error);
      return false;
    }
  }
}

module.exports = AppManager;
