/**
 * Sistema di gestione istanze
 * Tiene traccia delle informazioni sulla vita dell'istanza corrente
 */
class InstanceTracker {
  /**
   * Crea un nuovo tracker di istanza
   * @param {string} instanceId - ID univoco dell'istanza
   */
  constructor(instanceId) {
    this.instanceId = instanceId;
    this.startTime = new Date();
    this.restartCount = 0;
    this.lastRestartTime = null;
    this.isTerminating = false;
    this.terminationReason = null;
    this.operationCounts = {
      lockAcquired: 0,
      lockFailed: 0,
      botRestarts: 0,
      telegramErrors: 0,
      mongoErrors: 0
    };
  }

  /**
   * Registra un tentativo di riavvio
   */
  trackRestart() {
    this.restartCount++;
    this.lastRestartTime = new Date();
    this.operationCounts.botRestarts++;
  }

  /**
   * Inizia il processo di terminazione
   * @param {string} reason - Motivo della terminazione
   */
  startTermination(reason) {
    if (!this.isTerminating) {
      this.isTerminating = true;
      this.terminationReason = reason;
      this.terminationTime = new Date();
    }
  }

  /**
   * Registra un'operazione effettuata
   * @param {string} operationType - Tipo di operazione
   */
  trackOperation(operationType) {
    if (this.operationCounts[operationType] !== undefined) {
      this.operationCounts[operationType]++;
    } else {
      this.operationCounts[operationType] = 1;
    }
  }

  /**
   * Registra un errore
   * @param {string} errorType - Tipo di errore
   * @param {Error} error - Oggetto errore
   */
  trackError(errorType, error) {
    if (errorType === 'telegram') {
      this.operationCounts.telegramErrors++;
    } else if (errorType === 'mongo') {
      this.operationCounts.mongoErrors++;
    }
    
    // Potrebbe essere esteso per loggare i dettagli degli errori
  }

  /**
   * Ottiene la durata di vita dell'istanza in millisecondi
   * @returns {number} Durata di vita in ms
   */
  getLifetime() {
    const endTime = this.isTerminating ? this.terminationTime : new Date();
    return endTime - this.startTime;
  }

  /**
   * Calcola il tempo di attività in formato leggibile
   * @returns {string} Tempo di attività formattato
   */
  getFormattedUptime() {
    const uptime = this.getLifetime();
    
    const seconds = Math.floor(uptime / 1000) % 60;
    const minutes = Math.floor(uptime / (1000 * 60)) % 60;
    const hours = Math.floor(uptime / (1000 * 60 * 60)) % 24;
    const days = Math.floor(uptime / (1000 * 60 * 60 * 24));
    
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  }

  /**
   * Ottiene informazioni sull'istanza in formato oggetto
   * @returns {Object} Informazioni sull'istanza
   */
  getInfo() {
    return {
      instanceId: this.instanceId,
      startTime: this.startTime,
      uptime: this.getFormattedUptime(),
      restartCount: this.restartCount,
      lastRestartTime: this.lastRestartTime,
      isTerminating: this.isTerminating,
      terminationReason: this.terminationReason,
      operations: this.operationCounts
    };
  }

  /**
   * Ottiene informazioni sull'istanza in formato stringa
   * @returns {string} Informazioni sull'istanza
   */
  getInfoString() {
    const info = this.getInfo();
    
    return `
Instance ID: ${info.instanceId}
Started: ${info.startTime.toISOString()}
Uptime: ${info.uptime}
Restart Count: ${info.restartCount}
Status: ${info.isTerminating ? 'Terminating' : 'Running'}
${info.isTerminating ? `Termination Reason: ${info.terminationReason}` : ''}

Operations:
- Lock Acquired: ${info.operations.lockAcquired}
- Lock Failed: ${info.operations.lockFailed}
- Bot Restarts: ${info.operations.botRestarts}
- Telegram Errors: ${info.operations.telegramErrors}
- MongoDB Errors: ${info.operations.mongoErrors}
`;
  }
}

module.exports = InstanceTracker;
