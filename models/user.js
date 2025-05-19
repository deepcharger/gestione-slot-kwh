/**
 * Versione aggiornata del modello User con supporto per penalità
 */
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  telegram_id: {
    type: Number,
    required: true,
    unique: true
  },
  username: {
    type: String,
    required: true
  },
  first_interaction: {
    type: Date,
    default: Date.now
  },
  total_charges: {
    type: Number,
    default: 0
  },
  total_time: {
    type: Number,
    default: 0
  },
  last_charge: {
    type: Date,
    default: null
  },
  is_admin: {
    type: Boolean,
    default: false
  },
  // Campi per il sistema di penalità
  penalty_points: {
    type: Number,
    default: 0
  },
  last_penalty_date: {
    type: Date,
    default: null
  },
  temporarily_banned: {
    type: Boolean,
    default: false
  },
  ban_end_date: {
    type: Date,
    default: null
  },
  penalty_sessions: {
    type: Object,
    default: {}
  }
}, { timestamps: true });

// Indici per migliorare le prestazioni
userSchema.index({ username: 1 });
userSchema.index({ last_charge: -1 });
userSchema.index({ penalty_points: -1 });
userSchema.index({ temporarily_banned: 1, ban_end_date: 1 });

module.exports = mongoose.model('User', userSchema);
