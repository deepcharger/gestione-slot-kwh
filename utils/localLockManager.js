/**
 * Classe per la gestione dei lock locali (su file system)
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class LocalLockManager {
  /**
   * Crea una nuova istanza del gestore di lock locali
   * @param {string} instanceId - ID dell'istanza corrente
   */
  constructor(instanceId) {
    this.instanceId = instanceId;
    this.lockFilePath = path.join(process.cwd(), '.bot_lock');
    this.lockCheckCount = 0;
    this.lockCreateCount = 0;
    this.lockRemoveCount = 0;
  }

  /**
   * Crea un lock file locale con l'ID dell'istanza
   * @returns {boolean} true se il lock è stato creato con successo
   */
  createLockFile() {
    try {
      // Crea il file di lock con l'ID dell'istanza e timestamp
      const lockContent = JSON.stringify({
        instanceId: this.instanceId,
        createdAt: new Date().toISOString(),
        pid: process.pid
      });
      
      fs.writeFileSync(this.lockFilePath, lockContent);
      this.lockCreateCount++;
      
      logger.debug(`Lock file locale creato (${this.lockFilePath})`);
      return true;
    } catch (error) {
      logger.error(`Errore nella creazione del lock file locale:`, error);
      return false;
    }
  }

  /**
   * Verifica se esiste un lock file e se appartiene a questa istanza
   * @returns {boolean} true se il lock file esiste ed è di questa istanza
   */
  checkLockFile() {
    try {
      this.lockCheckCount++;
      
      if (fs.existsSync(this.lockFilePath)) {
        const lockContent = fs.readFileSync(this.lockFilePath, 'utf8');
        
        try {
          const lockData = JSON.parse(lockContent);
          
          // Verifica se il lock appartiene a questa istanza
          if (lockData.instanceId === this.instanceId) {
            return true;
          } else {
            logger.warn(`Lock file esiste ma appartiene a un'altra istanza: ${lockData.instanceId}`);
            
            // Controlla se il lock è vecchio (più di 5 minuti)
            const lockTime = new Date(lockData.createdAt);
            const now = new Date();
            const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
            
            if (lockTime < fiveMinutesAgo) {
              logger.warn(`Lock file è vecchio (${Math.round((now - lockTime) / 60000)} minuti), potrebbe essere orfano`);
            }
            
            return false;
          }
        } catch (err) {
          // Errore nel parsing del JSON, il lock file è probabilmente danneggiato
          logger.warn(`Lock file esiste ma è danneggiato, contenuto: ${lockContent}`);
          return false;
        }
      }
      
      logger.debug(`Lock file non esiste`);
      return false;
    } catch (error) {
      logger.error(`Errore nel controllo del lock file locale:`, error);
      return false;
    }
  }

  /**
   * Rimuove il lock file se appartiene a questa istanza
   * @returns {boolean} true se il lock file è stato rimosso con successo
   */
  removeLockFile() {
    try {
      if (this.checkLockFile()) {
        fs.unlinkSync(this.lockFilePath);
        this.lockRemoveCount++;
        
        logger.debug(`Lock file locale rimosso`);
        return true;
      }
      
      logger.debug(`Lock file non rimosso (non appartiene a questa istanza o non esiste)`);
      return false;
    } catch (error) {
      logger.error(`Errore nella rimozione del lock file locale:`, error);
      return false;
    }
  }

  /**
   * Aggiorna il timestamp del lock file
   * @returns {boolean} true se l'aggiornamento è riuscito
   */
  updateLockFile() {
    try {
      if (this.checkLockFile()) {
        // Leggi il lock esistente
        const lockContent = fs.readFileSync(this.lockFilePath, 'utf8');
        const lockData = JSON.parse(lockContent);
        
        // Aggiorna il timestamp
        lockData.updatedAt = new Date().toISOString();
        
        // Scrivi il lock aggiornato
        fs.writeFileSync(this.lockFilePath, JSON.stringify(lockData));
        
        logger.debug(`Lock file locale aggiornato`);
        return true;
      }
      
      logger.debug(`Lock file non aggiornato (non appartiene a questa istanza o non esiste)`);
      return false;
    } catch (error) {
      logger.error(`Errore nell'aggiornamento del lock file locale:`, error);
      return false;
    }
  }

  /**
   * Ottiene informazioni sul lock manager
   * @returns {Object} Informazioni sul lock manager
   */
  getInfo() {
    return {
      instanceId: this.instanceId,
      lockFilePath: this.lockFilePath,
      lockExists: fs.existsSync(this.lockFilePath),
      lockOwned: this.checkLockFile(),
      lockCheckCount: this.lockCheckCount,
      lockCreateCount: this.lockCreateCount,
      lockRemoveCount: this.lockRemoveCount
    };
  }
}

module.exports = LocalLockManager;
