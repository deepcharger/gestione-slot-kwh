# SlotManager Bot

Bot Telegram per gestire la coda e i turni delle colonnine di ricarica elettrica in spazi condivisi.

![Version](https://img.shields.io/badge/version-1.6.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D16.0.0-green)
![License](https://img.shields.io/badge/license-MIT-orange)

## 🔋 Panoramica

SlotManager Bot (@SlotManager_Bot) è una soluzione semplice ed efficace per gestire l'accesso condiviso alle colonnine di ricarica per veicoli elettrici. Ideale per condomini, piccole aziende, parcheggi condivisi o qualsiasi contesto in cui più utenti necessitano di condividere un numero limitato di colonnine di ricarica.

Tramite Telegram, gli utenti possono prenotare il proprio turno, ricevere notifiche quando una colonnina si libera, e confermare l'inizio e la fine delle proprie sessioni di ricarica, il tutto in modo trasparente e organizzato.

## ✨ Funzionalità principali

### Per gli utenti:
- **Prenotazione tramite chat**: semplice comando `/prenota` per richiedere uno slot o mettersi in coda
- **Sistema di coda automatico**: quando tutte le colonnine sono occupate, gli utenti vengono inseriti in coda
- **Notifiche in tempo reale**: avvisi quando è il proprio turno e promemoria prima della scadenza
- **Monitoraggio dello stato**: verifica della disponibilità delle colonnine e della propria posizione in coda
- **Gestione del tempo**: ogni utente ha un tempo massimo predefinito per la ricarica
- **Sistema di penalità**: incentiva l'uso responsabile con un sistema di punti penalità per ritardi

### Per gli amministratori:
- **Pannello di controllo completo**: comandi dedicati per monitorare e gestire l'intero sistema
- **Statistiche e analisi**: dati dettagliati sull'utilizzo delle colonnine
- **Configurazione flessibile**: possibilità di modificare il numero di colonnine, tempi massimi e altre impostazioni
- **Strumenti di gestione**: reset degli slot, rimozione di utenti dalla coda, invio di annunci globali
- **Monitoraggio delle penalità**: controllo degli utenti con penalità e ban temporanei

## 🛠️ Tecnologie utilizzate

- **Node.js**: Backend robusto e performante
- **MongoDB**: Database per la gestione persistente dei dati
- **API Telegram Bot**: Interfaccia utente accessibile tramite Telegram
- **Express**: Per il deployment in modalità webhook (opzionale)
- **Sistema di lock distribuito**: Per garantire l'affidabilità in ambienti multi-istanza

## 📋 Requisiti

- Node.js v16.0.0 o superiore
- MongoDB 4.4 o superiore
- Token Bot Telegram (ottenibile tramite [BotFather](https://t.me/botfather))
- Variabili d'ambiente configurate (vedi sezione Installazione)

## 🚀 Installazione

1. Clona questo repository:
```bash
git clone https://github.com/deepcharger/gestione-slot-kwh.git
cd gestione-slot-kwh
```

2. Installa le dipendenze:
```bash
npm install
```

3. Copia il file di esempio delle variabili d'ambiente:
```bash
cp .env.example .env
```

4. Configura le variabili d'ambiente nel file `.env`:
```
# Configurazione del bot Telegram
BOT_TOKEN=1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789

# Configurazione MongoDB
MONGODB_URI=(mondodb link)
# Configurazione admin
ADMIN_USER_ID=123456789

# Configurazione del gruppo autorizzato (opzionale)
AUTHORIZED_GROUP_ID=-1234567890
RESTRICT_TO_GROUP=false

# Configurazione del sistema
MAX_SLOTS=5
MAX_CHARGE_TIME=30
REMINDER_TIME=5

# Ambiente
NODE_ENV=development
```

5. Avvia il bot in modalità sviluppo:
```bash
npm run dev
```

6. Per l'ambiente di produzione:
```bash
npm start
```

## 📱 Comandi disponibili

### Comandi utente:
- `/start` - Avvia il bot e registra l'utente
- `/prenota` - Prenota uno slot di ricarica o entra in coda
- `/cancella` - Cancella la prenotazione in coda
- `/iniziato` - Conferma l'inizio della ricarica
- `/terminato` - Conferma la fine della ricarica
- `/status` - Visualizza lo stato attuale delle colonnine
- `/stato_utente` - Visualizza il tuo stato e eventuali penalità
- `/help` - Mostra l'elenco dei comandi disponibili
- `/dove_sono` - Mostra l'ID della chat corrente

### Comandi amministratore:
- `/admin_status` - Mostra lo stato dettagliato del sistema
- `/admin_stats` - Mostra statistiche di utilizzo
- `/admin_reset_slot @username` - Termina forzatamente una sessione di ricarica
- `/admin_remove_queue @username` - Rimuove un utente dalla coda
- `/admin_set_max_slots [numero]` - Imposta il numero massimo di slot disponibili
- `/admin_set_charge_time [minuti]` - Imposta il tempo massimo di ricarica
- `/admin_set_reminder_time [minuti]` - Imposta il tempo di promemoria
- `/admin_notify_all [messaggio]` - Invia un messaggio a tutti gli utenti
- `/admin_check_penalties` - Visualizza utenti con penalità
- `/admin_reset_system` - Resetta completamente il sistema
- `/admin_help` - Mostra i comandi admin disponibili

## 🌐 Deployment

### Render.com
Il bot è ottimizzato per essere ospitato su Render.com:

1. Importa il repository GitHub
2. Seleziona "Web Service" come tipo di servizio
3. Configura le variabili d'ambiente
4. Imposta `npm start` come comando di avvio

### Altre piattaforme
Il bot può essere ospitato su qualsiasi piattaforma che supporti Node.js e sia in grado di esporre un webhook HTTPS (per la modalità webhook) o mantenere una connessione persistente (per la modalità polling).

## 🔄 Flusso di lavoro tipico

1. L'utente invia `/prenota` per richiedere uno slot di ricarica
2. Se c'è uno slot disponibile, riceve conferma e può procedere con la ricarica
3. L'utente va alla colonnina, inizia la ricarica e conferma con `/iniziato`
4. Il bot avvisa l'utente 5 minuti prima della scadenza del tempo
5. L'utente completa la ricarica e conferma con `/terminato`
6. Il bot notifica il prossimo utente in coda, se presente

## 🔒 Sistema di penalità

Per responsabilizzare l'utilizzo delle colonnine e prevenire l'occupazione prolungata, il bot include un sistema di penalità:

1. I ritardi dopo il tempo massimo comportano punti penalità:
   - 5-15 minuti: 1 punto
   - 15-30 minuti: 2 punti
   - Oltre 30 minuti: 3 punti per ogni mezz'ora

2. Al raggiungimento di 10 punti penalità, l'account viene temporaneamente sospeso per 7 giorni

3. I punti penalità vengono azzerati automaticamente dopo 30 giorni dall'ultima infrazione

4. Gli utenti possono visualizzare il proprio stato e le eventuali penalità con il comando `/stato_utente`

## 📊 Monitoraggio e manutenzione

- I log dettagliati vengono salvati nella cartella `logs/`
- Utilizzare i comandi admin per monitorare lo stato del sistema
- In caso di problemi, controllare la connessione al database e la validità del token del bot

## 🤝 Contributi

I contributi sono benvenuti! Se desideri migliorare questo progetto:

1. Fai il fork del repository
2. Crea un branch per la tua feature (`git checkout -b feature/amazing-feature`)
3. Commit dei tuoi cambiamenti (`git commit -m 'Add amazing feature'`)
4. Push al branch (`git push origin feature/amazing-feature`)
5. Apri una Pull Request

## 📜 Licenza

Distribuito sotto licenza MIT. Vedi `LICENSE` per maggiori informazioni.

## 🔜 Roadmap futura

- Supporto multilingua
- Integrazione con sistemi di pagamento
- Dashboard web per amministratori
- Statistiche avanzate con visualizzazioni grafiche
- Supporto per hardware specifico delle colonnine

## 📋 Changelog

### v1.6.0 - (19 Maggio 2025)
- **Aggiunto**: Sistema di penalità per responsabilizzare l'uso delle colonnine
- **Aggiunto**: Nuovo comando `/stato_utente` per visualizzare lo stato e le penalità

### v1.5.1 - (14 Maggio 2025)
- **Aggiunto**: Sistema di penalità per responsabilizzare l'uso delle colonnine
- **Aggiunto**: Nuovo comando `/stato_utente` per visualizzare lo stato e le penalità
- **Aggiunto**: Supporto per il fuso orario italiano (Europe/Rome)
- **Migliorato**: Visualizzazione orari nel formato locale italiano
- **Corretto**: Orari nelle notifiche di inizio/fine ricarica
- **Aggiornato**: Funzione `formatTime()` per utilizzare il fuso orario corretto
- **Ottimizzato**: Gestione dell'ora legale/solare

### v1.0.0 - (30 Aprile 2025)
- Release iniziale
- Sistema completo di prenotazione e gestione code
- Notifiche automatiche
- Pannello amministratore
- Deployment su Render.com
