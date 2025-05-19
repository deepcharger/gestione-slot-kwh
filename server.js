/**
 * Versione alternativa di app.js per l'esecuzione con webhook
 * (specifico per Render.com o altre piattaforme cloud)
 */
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('./utils/logger');
const config = require('./config');

// Componenti dell'applicazione
const messageHandler = require('./handlers/messageHandler');
const notifier = require('./utils/notifier');

// Aggiungere questa riga per disabilitare i warning di Bluebird
process.env.BLUEBIRD_WARNINGS = '0';

// ID univoco dell'istanza
const INSTANCE_ID = `instance_${Date.now()}_${uuidv4().split('-')[0]}`;

// Inizializza Express
const app = express();
app.use(express.json());

// Variabili globali per bot e notifiche
let bot = null;
let notificationSystem = null;
let lastActiveTime = Date.now();

// Imposta il path per il health check di Render
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

// Endpoint per impostare il webhook (senza necessità di script locale)
app.get('/setup-webhook', async (req, res) => {
  try {
    const bot = new TelegramBot(config.BOT_TOKEN, { polling: false });
    const webhookUrl = `https://${req.headers.host}/webhook/${config.BOT_TOKEN}`;
    
    await bot.setWebHook(webhookUrl);
    const webhookInfo = await bot.getWebHookInfo();
    
    logger.info(`Webhook impostato su ${webhookUrl}`);
    logger.info(`Info webhook: ${JSON.stringify(webhookInfo)}`);
    
    res.json({
      success: true,
      message: `Webhook impostato correttamente su ${webhookUrl}`,
      webhookInfo
    });
  } catch (error) {
    logger.error('Errore nell\'impostazione del webhook:', error);
    res.status(500).json({
      success: false,
      message: `Errore nell'impostazione del webhook: ${error.message}`,
      error: error.toString()
    });
  }
});

// Stampa informazioni all'avvio
logger.info('====== AVVIO BOT SLOTMANAGER (WEBHOOK MODE) ======');
logger.info(`Versione Node: ${process.version}`);
logger.info(`Versione mongoose: ${mongoose.version}`);
logger.info(`Instance ID: ${INSTANCE_ID}`);
logger.info(`Bot token length: ${config.BOT_TOKEN ? config.BOT_TOKEN.length : 'undefined'}`);
logger.info(`MongoDB URI: ${config.MONGODB_URI ? 'Configurato' : 'Non configurato'}`);
logger.info(`Admin user ID: ${config.ADMIN_USER_ID || 'Non configurato'}`);
logger.info(`Environment: ${config.ENVIRONMENT}`);
logger.info(`MAX_SLOTS: ${config.MAX_SLOTS}`);
logger.info(`MAX_CHARGE_TIME: ${config.MAX_CHARGE_TIME}`);
logger.info(`REMINDER_TIME: ${config.REMINDER_TIME}`);

// Opzioni per la connessione MongoDB
const mongooseOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 15000,
  socketTimeoutMS: 60000,
  family: 4,
  connectTimeoutMS: 30000,
  heartbeatFrequencyMS: 10000,
  retryWrites: true,
  maxPoolSize: 20,
  minPoolSize: 5
};

// Gestione eventi di MongoDB
mongoose.connection.on('connecting', () => {
  logger.info('MongoDB: tentativo di connessione in corso...');
});

mongoose.connection.on('connected', () => {
  logger.info('MongoDB: connesso con successo');
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB: disconnesso');
  logger.info('MongoDB: tentativo di riconnessione...');
});

mongoose.connection.on('error', (err) => {
  logger.error(`MongoDB: errore di connessione: ${err.message}`);
});

// Connessione al database e avvio del bot
mongoose.connect(config.MONGODB_URI, mongooseOptions)
  .then(async () => {
    logger.info('✅ Connessione a MongoDB riuscita');
    
    // Inizializza il bot in modalità webhook
    bot = new TelegramBot(config.BOT_TOKEN, { polling: false });
    
    // Endpoint per ricevere gli aggiornamenti da Telegram
    app.post(`/webhook/${config.BOT_TOKEN}`, (req, res) => {
      lastActiveTime = Date.now(); // Aggiorna il timestamp di attività
      bot.processUpdate(req.body);
      res.sendStatus(200);
    });
    
    // Inizializza gli handler dei messaggi
    await messageHandler.init(bot);
    
    // Avvia il sistema di notifiche
    notificationSystem = notifier.startNotificationSystem(bot);
    
    // Sistema di rilevamento risveglio da sleep
    // Verifica periodicamente se il servizio è stato risvegliato
    setInterval(() => {
      const now = Date.now();
      // Se sono passati più di 20 minuti dall'ultima attività
      if (now - lastActiveTime > 20 * 60 * 1000) {
        logger.info('Rilevato possibile risveglio da spin down, riavvio sistema notifiche');
        if (notificationSystem && notificationSystem.stop) {
          notificationSystem.stop();
        }
        notificationSystem = notifier.startNotificationSystem(bot);
        lastActiveTime = now;
      }
    }, 5 * 60 * 1000); // Controlla ogni 5 minuti
    
    logger.info('✅ Bot inizializzato correttamente in modalità webhook');
    
    // Avvia il server Express
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      logger.info(`🚀 Server webhook in ascolto sulla porta ${PORT}`);
    });
  })
  .catch(err => {
    logger.error('❌ Errore di connessione a MongoDB:', err);
    logger.error(`URI MongoDB: ${config.MONGODB_URI ? config.MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//****:****@') : 'undefined'}`);
    process.exit(1);
  });

// Gestione segnali di terminazione
process.on('SIGINT', () => {
  logger.info('Segnale SIGINT ricevuto, spegnimento bot in corso...');
  shutdownService('SIGINT')
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
});

process.on('SIGTERM', () => {
  logger.info('Segnale SIGTERM ricevuto, spegnimento bot in corso...');
  shutdownService('SIGTERM')
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
});

// Gestione eccezioni non catturate
process.on('uncaughtException', (err) => {
  logger.error('❌ Eccezione non gestita:', err);
  logger.error('Stack trace:', err.stack);
  logger.logMemoryUsage();
  
  shutdownService('UNCAUGHT_EXCEPTION')
    .then(() => process.exit(1))
    .catch(() => process.exit(1));
});

// Gestione promise rejection non gestite
process.on('unhandledRejection', (reason, promise) => {
  logger.error('❌ Promise rejection non gestita:', reason);
  logger.logMemoryUsage();
  
  shutdownService('UNHANDLED_REJECTION')
    .then(() => process.exit(1))
    .catch(() => process.exit(1));
});

/**
 * Funzione per gestire lo spegnimento controllato del servizio
 * @param {string} reason - Motivo dello spegnimento
 * @returns {Promise<void>}
 */
async function shutdownService(reason) {
  try {
    logger.info(`Avvio procedura di shutdown (${reason})...`);
    
    // Ferma il sistema di notifiche
    if (notificationSystem && notificationSystem.stop) {
      notificationSystem.stop();
      notificationSystem = null;
      logger.info('Sistema di notifiche fermato');
    }
    
    // Se possibile, invia un messaggio all'admin
    if (bot && config.ADMIN_USER_ID) {
      try {
        await bot.sendMessage(
          config.ADMIN_USER_ID,
          `🛑 *Bot in fase di spegnimento*\n\n` +
          `Motivo: ${reason}\n` +
          `Instance ID: ${INSTANCE_ID}\n` +
          `Data: ${new Date().toISOString()}`,
          { parse_mode: 'Markdown' }
        );
        logger.info('Messaggio di shutdown inviato all\'admin');
      } catch (err) {
        logger.warn('Impossibile inviare messaggio di shutdown all\'admin:', err.message);
      }
    }
    
    // Chiudi la connessione MongoDB
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
      logger.info('Connessione MongoDB chiusa');
    }
    
    logger.info(`Shutdown completato (${reason})`);
  } catch (error) {
    logger.error(`Errore durante lo shutdown: ${error.message}`);
  }
}
