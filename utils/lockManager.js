/**
 * Modulo per la gestione dei lock per la sincronizzazione tra istanze
 * Combinazione di lock su database e lock locali
 */
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const TelegramBot = require('node-telegram-bot-api');
const logger = require('./logger');
const config = require('../config');
const Lock = require('../models/lock');
const TaskLock = require('../models/taskLock');
const LocalLockManager = require('./localLockManager');

class LockManager {
  constructor(instanceId) {
    this.instanceId = instanceId;
    this.localLockManager = new LocalLockManager(instanceId);
    
    // Costanti per timeout
    this.GLOBAL_LOCK_TIMEOUT = 180000; // 180 secondi (3 minuti)
    this.TASK_LOCK_TIMEOUT = 60000; // 60 secondi per i task lock
    
    // Flag per il tracciamento dei conflitti Telegram
    this.telegramConflictDetected = false;
    this.lastTelegramConflictTime = null;
  }

  /**
   * Inizializza il lock manager
   */
  async initialize() {
    try {
      // Pulisci eventuali lock orfani appartenenti a questa istanza (improbabile ma per sicurezza)
      await Lock.deleteMany({ instance_id: this.instanceId });
      await TaskLock.deleteMany({ instance_id: this.instanceId });
      
      // Esegui una pulizia di emergenza all'avvio per evitare problemi con lock orfani
      await this.emergencyCleanupLocks();
      
      return true;
    } catch (error) {
      logger.error('Errore nell\'inizializzazione del LockManager:', error);
      return false;
    }
  }

  /**
   * Verifica se siamo l'istanza attiva per eseguire operazioni
   * @returns {Promise<boolean>} - true se siamo l'istanza attiva, false altrimenti
   */
  async isActiveInstance() {
    try {
      // Verifica se abbiamo un lock di esecuzione valido
      const executionLock = await Lock.findOne({
        name: 'execution_lock',
        lock_type: 'execution',
        instance_id: this.instanceId,
        last_heartbeat: { $gt: new Date(Date.now() - this.GLOBAL_LOCK_TIMEOUT) }
      });
      
      // Se non abbiamo un lock valido, non siamo l'istanza attiva
      if (!executionLock) {
        return false;
      }
      
      // Verifica se ci sono altre istanze con lock di esecuzione più recenti
      const newerLock = await Lock.findOne({
        name: 'execution_lock',
        lock_type: 'execution',
        instance_id: { $ne: this.instanceId },
        last_heartbeat: { $gt: executionLock.last_heartbeat }
      });
      
      // Se c'è un'istanza con un lock più recente, non siamo l'istanza attiva
      if (newerLock) {
        return false;
      }
      
      // Siamo l'istanza attiva
      return true;
    } catch (error) {
      logger.error('Errore nella verifica dell\'istanza attiva:', error);
      // In caso di errore, assumiamo che non siamo l'istanza attiva per sicurezza
      return false;
    }
  }

  /**
   * Acquisice un lock per un'operazione specifica
   * @param {string} taskName - Nome dell'operazione
   * @param {number} timeoutMs - Timeout in millisecondi per il lock
   * @returns {Promise<{success: boolean, lockId: string|null}>} - Risultato dell'acquisizione
   */
  async acquireTaskLock(taskName, timeoutMs = this.TASK_LOCK_TIMEOUT) {
    try {
      // Genera un ID univoco per il lock
      const lockId = `${taskName}_${Date.now()}_${uuidv4().split('-')[0]}`;
      
      // MODIFICATO: Aggiungi un controllo per i lock di test Telegram
      if (taskName === 'telegram_test') {
        // Elimina preventivamente lock molto vecchi (creati da più di 1 minuto)
        const oneMinuteAgo = new Date(Date.now() - 60000);
        await TaskLock.deleteMany({
          task_name: 'telegram_test',
          created_at: { $lt: oneMinuteAgo }
        });
      }
      
      // Verifica che non ci siano già lock attivi per questa operazione
      const existingLock = await TaskLock.findOne({
        task_name: taskName,
        expires_at: { $gt: new Date() }
      });
      
      if (existingLock) {
        // MODIFICATO: Se è un lock telegram_test molto vecchio, forzane la rimozione
        if (taskName === 'telegram_test') {
          const lockAge = Date.now() - new Date(existingLock.created_at).getTime();
          if (lockAge > 60000) { // 1 minuto
            logger.warn(`Rilevato lock telegram_test vecchio (${Math.round(lockAge/1000)}s), forzatura rimozione`);
            await TaskLock.deleteOne({ _id: existingLock._id });
            
            // Crea un nuovo lock
            const taskLock = new TaskLock({
              task_name: taskName,
              lock_id: lockId,
              instance_id: this.instanceId,
              created_at: new Date(),
              expires_at: new Date(Date.now() + timeoutMs)
            });
            
            await taskLock.save();
            
            logger.info(`Lock forzato per l'operazione ${taskName} (ID: ${lockId})`);
            return { success: true, lockId };
          }
        }
        
        // C'è già un lock attivo
        return { success: false, lockId: null };
      }
      
      // Calcola la scadenza del lock
      const expiresAt = new Date(Date.now() + timeoutMs);
      
      // Crea un nuovo lock
      const taskLock = new TaskLock({
        task_name: taskName,
        lock_id: lockId,
        instance_id: this.instanceId,
        created_at: new Date(),
        expires_at: expiresAt
      });
      
      await taskLock.save();
      
      logger.debug(`Lock acquisito per l'operazione ${taskName} (ID: ${lockId})`);
      return { success: true, lockId };
    } catch (error) {
      logger.error(`Errore nell'acquisizione del lock per l'operazione ${taskName}:`, error);
      return { success: false, lockId: null };
    }
  }

  /**
   * Rilascia un lock per un'operazione
   * @param {string} taskName - Nome dell'operazione
   * @param {string} lockId - ID del lock da rilasciare
   * @returns {Promise<boolean>} - true se il lock è stato rilasciato, false altrimenti
   */
  async releaseTaskLock(taskName, lockId) {
    try {
      // Rilascia il lock
      const result = await TaskLock.deleteOne({
        task_name: taskName,
        lock_id: lockId
      });
      
      if (result.deletedCount > 0) {
        logger.debug(`Lock rilasciato per l'operazione ${taskName} (ID: ${lockId})`);
        return true;
      }
      
      logger.warn(`Lock non trovato per l'operazione ${taskName} (ID: ${lockId})`);
      return false;
    } catch (error) {
      logger.error(`Errore nel rilascio del lock per l'operazione ${taskName}:`, error);
      return false;
    }
  }

  /**
   * Esegue un'operazione con lock di sicurezza
   * @param {string} taskName - Nome dell'operazione
   * @param {Function} taskFunction - Funzione da eseguire
   * @param {number} timeoutMs - Timeout in millisecondi per il lock
   * @returns {Promise<any>} - Risultato dell'operazione
   */
  async executeWithLock(taskName, taskFunction, timeoutMs = this.TASK_LOCK_TIMEOUT) {
    // Acquisisce il lock
    const { success, lockId } = await this.acquireTaskLock(taskName, timeoutMs);
    
    if (!success || !lockId) {
      // Non è stato possibile acquisire il lock, l'operazione è già in corso
      logger.info(`Operazione ${taskName} già in corso, salto l'esecuzione`);
      return null;
    }
    
    try {
      // Esegue l'operazione
      const result = await taskFunction();
      return result;
    } catch (error) {
      logger.error(`Errore nell'esecuzione dell'operazione ${taskName}:`, error);
      throw error;
    } finally {
      // Rilascia il lock in ogni caso
      await this.releaseTaskLock(taskName, lockId);
    }
  }

  /**
   * Pulisce i lock di test Telegram orfani
   * @returns {Promise<number>} - Numero di lock rimossi
   */
  async cleanupTelegramTestLocks() {
    try {
      // Elimina lock scaduti
      const expiredResult = await TaskLock.deleteMany({
        task_name: 'telegram_test',
        expires_at: { $lt: new Date() }
      });
      
      // Elimina anche lock molto vecchi (creati da più di 2 minuti) indipendentemente dalla scadenza
      // Questo copre i casi in cui il processo è terminato senza rilasciare il lock
      const twoMinutesAgo = new Date(Date.now() - 120000);
      const oldResult = await TaskLock.deleteMany({
        task_name: 'telegram_test',
        created_at: { $lt: twoMinutesAgo }
      });
      
      const totalRemoved = expiredResult.deletedCount + oldResult.deletedCount;
      
      if (totalRemoved > 0) {
        logger.info(`Rimossi ${totalRemoved} lock di test Telegram obsoleti`);
      }
      
      return totalRemoved;
    } catch (error) {
      logger.error('Errore nella pulizia dei lock di test Telegram:', error);
      return 0;
    }
  }

  /**
   * Pulisce i task lock scaduti
   * @returns {Promise<number>} - Numero di lock scaduti rimossi
   */
  async cleanupExpiredTaskLocks() {
    try {
      // Pulisci i task lock scaduti
      const result = await TaskLock.deleteMany({
        expires_at: { $lt: new Date() }
      });
      
      let deletedCount = result.deletedCount;
      
      // Aggiungi la pulizia specifica per i lock di test Telegram 
      deletedCount += await this.cleanupTelegramTestLocks();
      
      if (deletedCount > 0) {
        logger.info(`Rimossi ${deletedCount} task lock scaduti`);
      }
      
      return deletedCount;
    } catch (error) {
      logger.error('Errore nella pulizia dei task lock scaduti:', error);
      return 0;
    }
  }

  /**
   * Funzione per gestire situazioni di stallo dei lock
   * @returns {Promise<boolean>} - true se la pulizia è stata eseguita con successo
   */
  async emergencyCleanupLocks() {
    logger.warn('Esecuzione pulizia di emergenza dei lock');
    
    try {
      // Rimuovi TUTTI i lock di test Telegram
      const telegramTestResult = await TaskLock.deleteMany({ task_name: 'telegram_test' });
      logger.info(`Rimossi ${telegramTestResult.deletedCount} lock di test Telegram in emergenza`);
      
      // Controlla se ci sono altri lock che potrebbero bloccarci
      const activeLocks = await TaskLock.find({ instance_id: { $ne: this.instanceId } });
      
      if (activeLocks.length > 0) {
        logger.warn(`Rilevati ${activeLocks.length} lock attivi di altre istanze`);
        
        // Rimuovi lock molto vecchi (oltre 5 minuti)
        const fiveMinutesAgo = new Date(Date.now() - 300000);
        const oldLocksResult = await TaskLock.deleteMany({
          instance_id: { $ne: this.instanceId },
          created_at: { $lt: fiveMinutesAgo }
        });
        
        logger.info(`Rimossi ${oldLocksResult.deletedCount} lock molto vecchi di altre istanze`);
      }
      
      return true;
    } catch (error) {
      logger.error('Errore durante la pulizia di emergenza:', error);
      return false;
    }
  }

  /**
   * Verifica se è possibile connettersi a Telegram senza conflitti
   * @returns {Promise<boolean>} - true se la connessione è riuscita
   */
  async testTelegramConnection() {
    // Variabile per tenere traccia dell'ID del lock acquisito
    let acquiredLockId = null;
    
    // Se abbiamo rilevato un conflitto negli ultimi 60 secondi, meglio attendere
    if (this.telegramConflictDetected && this.lastTelegramConflictTime) {
      const timeSinceLastConflict = Date.now() - this.lastTelegramConflictTime;
      if (timeSinceLastConflict < 60000) { // 60 secondi
        logger.warn(`Conflitto Telegram rilevato ${Math.round(timeSinceLastConflict/1000)}s fa, meglio attendere`);
        return false;
      }
    }

    try {
      // Usiamo un lock per evitare che più istanze tentino di testare contemporaneamente
      const { success, lockId } = await this.acquireTaskLock('telegram_test', 20000); // 20 secondi 
      acquiredLockId = lockId; // Salva l'ID del lock per rilasciarlo alla fine
      
      if (!success) {
        // Controlla quando scade il lock attuale
        try {
          const existingLock = await TaskLock.findOne({
            task_name: 'telegram_test',
            expires_at: { $gt: new Date() }
          });
          
          if (existingLock) {
            const timeLeft = Math.round((new Date(existingLock.expires_at) - new Date()) / 1000);
            logger.warn(`Un'altra istanza sta già testando la connessione Telegram (${existingLock.instance_id}), attendiamo ${timeLeft}s`);
          } else {
            logger.warn(`Un'altra istanza sta già testando la connessione Telegram, attendiamo`);
          }
        } catch (err) {
          logger.warn(`Un'altra istanza sta già testando la connessione Telegram, attendiamo`);
        }
        
        return false;
      }
      
      // Esegui il test di connessione
      const testBot = new TelegramBot(config.BOT_TOKEN, { polling: false });
      await testBot.getMe();
      
      // Reset del flag di conflitto se la connessione ha successo
      this.telegramConflictDetected = false;
      
      return true;
    } catch (error) {
      if (error.code === 'ETELEGRAM' && error.message && error.message.includes('409 Conflict')) {
        logger.warn('Conflitto Telegram rilevato durante il test di connessione');
        // Setta il flag di conflitto e il timestamp
        this.telegramConflictDetected = true;
        this.lastTelegramConflictTime = Date.now();
        return false;
      }
      logger.error('Errore durante il test di connessione a Telegram:', error);
      // In caso di altri errori, meglio evitare di connettersi
      return false;
    } finally {
      // Rilascia SEMPRE il lock se è stato acquisito
      if (acquiredLockId) {
        try {
          await this.releaseTaskLock('telegram_test', acquiredLockId);
          logger.debug(`Lock Telegram test rilasciato (ID: ${acquiredLockId})`);
        } catch (err) {
          logger.error(`Errore nel rilascio del lock Telegram test (ID: ${acquiredLockId}):`, err);
        }
      }
    }
  }

  /**
   * Tenta di acquisire il master lock
   * Il master lock è un lock esclusivo che determina quale istanza ha il diritto di provare 
   * ad acquisire il lock di esecuzione. Solo una istanza alla volta può avere il master lock.
   * @returns {Promise<boolean>} - true se il lock è stato acquisito
   */
  async acquireMasterLock() {
    try {
      logger.info(`Tentativo di acquisire il master lock per l'istanza ${this.instanceId}...`);
      
      // Prima verifica se possiamo connetterci a Telegram senza conflitti
      const canConnectToTelegram = await this.testTelegramConnection();
      if (!canConnectToTelegram) {
        logger.warn('Test di connessione a Telegram fallito, attesa prima di riprovare...');
        return false;
      }
      
      // Verifica se c'è già un'istanza attiva con un lock di esecuzione
      const activeLock = await Lock.findOne({ 
        lock_type: 'execution',
        last_heartbeat: { $gt: new Date(Date.now() - this.GLOBAL_LOCK_TIMEOUT) } // Considerare attivi i lock con heartbeat negli ultimi 3 minuti
      });
      
      if (activeLock) {
        // Ignora il lock se appartiene a questa istanza (potrebbe succedere in casi rari)
        if (activeLock.instance_id === this.instanceId) {
          logger.info(`Il lock di esecuzione appartiene già a questa istanza, continuando...`);
        } else {
          // Se c'è già un'istanza attiva, attendiamo di più
          logger.info(`Rilevato un lock di esecuzione attivo: ${activeLock.instance_id}`);
          logger.info(`L'istanza ${activeLock.instance_id} è attiva. Attendiamo più a lungo prima di riprovare.`);
          return false;
        }
      }
      
      // Cerca lock scaduti (vecchi) e li rimuove
      const staleLocksRemoved = await Lock.deleteMany({
        last_heartbeat: { $lt: new Date(Date.now() - this.GLOBAL_LOCK_TIMEOUT) }
      });
      
      if (staleLocksRemoved.deletedCount > 0) {
        logger.info(`Rimossi ${staleLocksRemoved.deletedCount} lock scaduti`);
      }
      
      // Verifica se esiste già un master lock valido
      const masterLock = await Lock.findOne({ 
        name: 'master_lock',
        lock_type: 'master',
        last_heartbeat: { $gt: new Date(Date.now() - this.GLOBAL_LOCK_TIMEOUT) } // Considerare attivi i lock con heartbeat negli ultimi 3 minuti
      });
      
      if (masterLock) {
        // Se c'è già un master lock attivo e non è di questa istanza, attendere e riprovare
        if (masterLock.instance_id !== this.instanceId) {
          logger.info(`Master lock già acquisito da un'altra istanza (${masterLock.instance_id}), attendere...`);
          return false;
        } else {
          // Se il master lock è già di questa istanza, lo aggiorniamo
          logger.info(`Master lock già nostro, aggiornamento heartbeat`);
          masterLock.last_heartbeat = new Date();
          await masterLock.save();
          return true;
        }
      }
      
      // Se ci sono lock scaduti, li eliminiamo
      await Lock.deleteMany({
        name: 'master_lock',
        lock_type: 'master',
        last_heartbeat: { $lt: new Date(Date.now() - this.GLOBAL_LOCK_TIMEOUT) }
      });
      
      // Creazione del master lock
      const lock = new Lock({
        name: 'master_lock',
        lock_type: 'master',
        instance_id: this.instanceId,
        created_at: new Date(),
        last_heartbeat: new Date()
      });
      
      await lock.save();
      logger.info(`Master lock acquisito con successo da ${this.instanceId}`);
      
      return true;
    } catch (error) {
      logger.error(`Errore durante l'acquisizione del master lock:`, error);
      return false;
    }
  }

  /**
   * Tenta di acquisire il lock di esecuzione
   * Il lock di esecuzione determina quale istanza può effettivamente eseguire il bot
   * @returns {Promise<boolean>} - true se il lock è stato acquisito
   */
  async acquireExecutionLock() {
    try {
      logger.info(`Tentativo di acquisire il lock di esecuzione per l'istanza ${this.instanceId}...`);
      
      // Prima verifica se possiamo connetterci a Telegram senza conflitti
      const canConnectToTelegram = await this.testTelegramConnection();
      if (!canConnectToTelegram) {
        logger.warn('Test di connessione a Telegram fallito prima di acquisire execution lock, attesa prima di riprovare...');
        return false;
      }
      
      // Verifica se esiste già un lock di esecuzione valido
      const executionLock = await Lock.findOne({ 
        name: 'execution_lock',
        lock_type: 'execution',
        last_heartbeat: { $gt: new Date(Date.now() - this.GLOBAL_LOCK_TIMEOUT) } // Considerare attivi i lock con heartbeat negli ultimi 3 minuti
      });
      
      if (executionLock) {
        // Se c'è già un lock di esecuzione attivo e non è di questa istanza, attendere e riprovare
        if (executionLock.instance_id !== this.instanceId) {
          logger.info(`Lock di esecuzione già acquisito da un'altra istanza (${executionLock.instance_id}), attesa...`);
          return false;
        } else {
          // Se il lock di esecuzione è già di questa istanza, lo aggiorniamo
          logger.info(`Lock di esecuzione già nostro, aggiornamento heartbeat`);
          executionLock.last_heartbeat = new Date();
          await executionLock.save();
          return true;
        }
      }
      
      // Se ci sono lock scaduti, li eliminiamo
      const oldLocksResult = await Lock.deleteMany({
        name: 'execution_lock',
        lock_type: 'execution',
        last_heartbeat: { $lt: new Date(Date.now() - this.GLOBAL_LOCK_TIMEOUT) }
      });
      
      if (oldLocksResult.deletedCount > 0) {
        logger.info(`Eliminati ${oldLocksResult.deletedCount} lock di esecuzione scaduti`);
      }
      
      // Creazione del lock di esecuzione
      const lock = new Lock({
        name: 'execution_lock',
        lock_type: 'execution',
        instance_id: this.instanceId,
        created_at: new Date(),
        last_heartbeat: new Date()
      });
      
      await lock.save();
      logger.info(`Lock di esecuzione acquisito con successo da ${this.instanceId}`);
      
      // Crea anche un lock file locale
      if (this.localLockManager.createLockFile()) {
        logger.debug(`Lock file locale creato`);
      } else {
        logger.warn(`Impossibile creare lock file locale`);
      }
      
      return true;
    } catch (error) {
      logger.error(`Errore durante l'acquisizione del lock di esecuzione:`, error);
      return false;
    }
  }

  /**
   * Aggiorna il heartbeat del lock di esecuzione
   * @returns {Promise<boolean>} - true se l'aggiornamento è riuscito
   */
  async updateExecutionLockHeartbeat() {
    try {
      // Usa executeWithLock per evitare operazioni concorrenti
      return await this.executeWithLock('execution_heartbeat', async () => {
        const lock = await Lock.findOne({ 
          name: 'execution_lock', 
          lock_type: 'execution',
          instance_id: this.instanceId 
        });
        
        if (lock) {
          lock.last_heartbeat = new Date();
          await lock.save();
          logger.debug(`Heartbeat per lock di esecuzione inviato (${this.instanceId})`);
          return true;
        } else {
          logger.warn(`Lock di esecuzione non trovato durante heartbeat`);
          return false;
        }
      }, 20000); // 20 secondi di timeout
    } catch (error) {
      logger.error(`Errore durante l'aggiornamento del lock di esecuzione:`, error);
      return false;
    }
  }

  /**
   * Aggiorna il heartbeat del master lock
   * @returns {Promise<boolean>} - true se l'aggiornamento è riuscito
   */
  async updateMasterLockHeartbeat() {
    try {
      // Usa executeWithLock per evitare operazioni concorrenti
      return await this.executeWithLock('master_heartbeat', async () => {
        const lock = await Lock.findOne({ 
          name: 'master_lock', 
          lock_type: 'master',
          instance_id: this.instanceId 
        });
        
        if (lock) {
          lock.last_heartbeat = new Date();
          await lock.save();
          logger.debug(`Heartbeat per master lock inviato (${this.instanceId})`);
          return true;
        } else {
          logger.warn(`Master lock non trovato durante heartbeat`);
          return false;
        }
      });
    } catch (error) {
      logger.error(`Errore durante l'aggiornamento del master lock:`, error);
      return false;
    }
  }

  /**
   * Verifica lo stato dei lock locali
   * @returns {Promise<boolean>} - true se i lock locali sono validi
   */
  async checkLocalLocks() {
    try {
      // Verifica che il lock file locale sia ancora valido
      if (!this.localLockManager.checkLockFile()) {
        logger.warn(`Lock file locale non valido o mancante, tentativo di riacquisizione...`);
        
        // Tenta di ricreare il lock file locale
        if (this.localLockManager.createLockFile()) {
          logger.info(`Lock file locale ricreato con successo`);
          return true;
        } else {
          logger.error(`Impossibile ricreare lock file locale`);
          return false;
        }
      }
      
      return true;
    } catch (error) {
      logger.error(`Errore durante il controllo dei lock locali:`, error);
      return false;
    }
  }

  /**
   * Verifica la presenza di conflitti con altre istanze
   * @returns {Promise<boolean>} - true se non ci sono conflitti
   */
  async checkForInstanceConflicts() {
    try {
      // Verifica che entrambi i lock siano ancora validi
      const masterLock = await Lock.findOne({ 
        name: 'master_lock', 
        lock_type: 'master',
        instance_id: this.instanceId 
      });
      
      const executionLock = await Lock.findOne({ 
        name: 'execution_lock', 
        lock_type: 'execution',
        instance_id: this.instanceId 
      });
      
      // Verifica se ci sono altri lock di esecuzione attivi che non sono nostri
      if (executionLock) {
        const otherActiveLocks = await Lock.find({
          name: 'execution_lock',
          lock_type: 'execution',
          instance_id: { $ne: this.instanceId },
          last_heartbeat: { $gt: new Date(Date.now() - this.GLOBAL_LOCK_TIMEOUT) }
        });
        
        if (otherActiveLocks.length > 0) {
          logger.warn(`Rilevati ${otherActiveLocks.length} altri lock di esecuzione attivi, possibile conflitto.`);
          
          // Se abbiamo rilevato un conflitto Telegram recentemente, consideriamo la situazione critica
          if (this.telegramConflictDetected && this.lastTelegramConflictTime && 
              (Date.now() - this.lastTelegramConflictTime < 120000)) { // 2 minuti
              
            logger.warn('Conflitto Telegram recente rilevato in combinazione con altri lock, situazione critica');
            return false;
          }
        }
      }
      
      // Se uno dei due lock non è presente, c'è un conflitto potenziale
      if (!masterLock || !executionLock) {
        logger.warn(`Lock non trovato: ${!masterLock ? 'master_lock' : 'execution_lock'}`);
        return false;
      }
      
      return true;
    } catch (error) {
      logger.error(`Errore durante il controllo dei conflitti di istanza:`, error);
      return false;
    }
  }

  /**
   * Rilascia tutti i lock per questa istanza
   * @returns {Promise<boolean>} - true se i lock sono stati rilasciati
   */
  async releaseAllLocks() {
    try {
      // Rilascia tutti i task lock
      await TaskLock.deleteMany({ instance_id: this.instanceId });
      
      // Rilascia i lock globali
      await Lock.deleteMany({ instance_id: this.instanceId });
      
      // Rilascia il lock file locale
      this.localLockManager.removeLockFile();
      
      logger.info(`Tutti i lock rilasciati per l'istanza ${this.instanceId}`);
      return true;
    } catch (error) {
      logger.error(`Errore durante il rilascio di tutti i lock:`, error);
      return false;
    }
  }
}

module.exports = LockManager;
