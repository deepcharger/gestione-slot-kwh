/**
 * Punto di ingresso dell'applicazione
 * Avvia l'applicazione e gestisce gli errori e i segnali di terminazione
 */
// Aggiungere questa riga all'inizio per disabilitare i warning di Bluebird
process.env.BLUEBIRD_WARNINGS = '0';

const logger = require('./utils/logger');
const AppManager = require('./utils/appManager');

// Istanza dell'app manager
const appManager = new AppManager();

// Avvia l'app
appManager.initialize()
  .then(success => {
    if (!success) {
      logger.error('❌ Inizializzazione fallita');
      process.exit(1);
    } else {
      logger.info('✅ Inizializzazione completata con successo');
    }
  })
  .catch(err => {
    logger.error('❌ Errore fatale durante l\'inizializzazione:', err);
    process.exit(1);
  });

// Gestione segnali di terminazione
process.on('SIGINT', async () => {
  logger.info('Segnale SIGINT ricevuto, spegnimento in corso...');
  await appManager.performShutdown('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Segnale SIGTERM ricevuto, spegnimento in corso...');
  await appManager.performShutdown('SIGTERM');
  process.exit(0);
});

// Gestione eccezioni non catturate
process.on('uncaughtException', async (err) => {
  logger.error('❌ Eccezione non gestita:', err);
  logger.error('Stack trace:', err.stack);
  logger.logMemoryUsage();
  
  await appManager.performShutdown('UNCAUGHT_EXCEPTION');
  process.exit(1);
});

// Gestione promise rejection non gestite
process.on('unhandledRejection', async (reason, promise) => {
  logger.error('❌ Promise rejection non gestita:', reason);
  logger.logMemoryUsage();
  
  await appManager.performShutdown('UNHANDLED_REJECTION');
  process.exit(1);
});
