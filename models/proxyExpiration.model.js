/**
 * ProxyExpiration Schema & Models
 * Gestion complète de l'expiration des proxies (ISP, Résidentiel, Datacenter)
 */

const mongoose = require('mongoose');

// ============================================
// PROXY SCHEMA AMÉLIORÉ
// ============================================
const ProxySchema = new mongoose.Schema({
  // Identifiants
  proxyId: { type: Number, unique: true, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  
  // Type et catégorie
  type: { 
    type: String, 
    enum: ['isp', 'residential', 'datacenter'],
    default: 'residential',
    index: true,
    required: true
  },
  
  // Informations de connexion
  credentials: {
    username: { type: String, required: true },
    password: { type: String, required: true },
    host: { type: String, required: true },
    port: { type: Number, required: true },
    protocol: { type: String, enum: ['http', 'https', 'socks5'], default: 'http' }
  },
  
  // Détails du package
  packageDetails: {
    name: { type: String }, // "Golden", "Silver", etc.
    duration: { type: Number }, // durée en jours
    price: { type: Number }
  },
  
  // Dates clés pour l'expiration
  purchaseDate: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date, required: true, index: true },
  renewalReminderSentAt: { type: Date, default: null },
  
  // États d'expiration
  status: {
    type: String,
    enum: ['active', 'expiring_soon', 'expired', 'renewed', 'cancelled'],
    default: 'active',
    index: true
  },
  
  // Statistiques d'utilisation
  stats: {
    totalRequests: { type: Number, default: 0 },
    bandwidthUsed: { type: Number, default: 0 }, // en GB
    lastUsedAt: { type: Date, default: null },
    totalSessions: { type: Number, default: 0 }
  },
  
  // Informations géographiques et réseau
  locationInfo: {
    country: { type: String },
    city: { type: String },
    isp: { type: String },
    ip: { type: String }
  },
  
  // Configuration avancée
  rotation: {
    enabled: { type: Boolean, default: false },
    interval: { type: Number }, // en secondes
    lastRotation: { type: Date }
  },
  
  // Historique des renouvellements
  renewalHistory: [{
    renewedAt: { type: Date, default: Date.now },
    previousExpiryDate: { type: Date },
    newExpiryDate: { type: Date },
    renewalDuration: { type: Number },
    renewalCost: { type: Number }
  }],
  
  // Notes et tags
  tags: [{ type: String }],
  notes: { type: String },
  
  // Métadonnées
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// ============================================
// EXPIRATION ALERT SCHEMA
// ============================================
const ExpirationAlertSchema = new mongoose.Schema({
  proxyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Proxy', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  
  // Type d'alerte
  alertType: {
    type: String,
    enum: ['7_days_before', '3_days_before', '1_day_before', 'expired', 'custom'],
    required: true
  },
  
  // État de l'alerte
  status: {
    type: String,
    enum: ['pending', 'sent', 'acknowledged', 'dismissed'],
    default: 'pending'
  },
  
  // Détails du proxy au moment de l'alerte
  proxyDetails: {
    type: { type: String, enum: ['isp', 'residential', 'datacenter'] },
    expiresAt: { type: Date },
    daysRemaining: { type: Number },
    price: { type: Number }
  },
  
  // Notification
  notificationChannels: {
    email: { type: Boolean, default: true },
    inApp: { type: Boolean, default: true },
    sms: { type: Boolean, default: false }
  },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  sentAt: { type: Date, default: null },
  acknowledgedAt: { type: Date, default: null }
}, { timestamps: true });

// ============================================
// PROXY RENEWAL SCHEMA
// ============================================
const ProxyRenewalSchema = new mongoose.Schema({
  proxyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Proxy', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  
  // Détails du renouvellement
  renewalType: {
    type: String,
    enum: ['auto_renewal', 'manual_renewal', 'upgrade'],
    default: 'manual_renewal'
  },
  
  // Configuration
  autoRenewal: {
    enabled: { type: Boolean, default: false },
    daysBeforeExpiry: { type: Number, default: 3 }, // Renouvellement automatique 3 jours avant
    renewalDuration: { type: Number }, // Nombre de jours à ajouter
    maxAutoRenewals: { type: Number, default: 0 }, // 0 = illimité
    timesAutoRenewed: { type: Number, default: 0 }
  },
  
  // Statut
  status: {
    type: String,
    enum: ['pending', 'scheduled', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  
  // Détails financiers
  cost: { type: Number, required: true },
  paymentMethod: { type: String },
  paymentStatus: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  
  // Dates
  requestedAt: { type: Date, default: Date.now },
  scheduledFor: { type: Date },
  completedAt: { type: Date, default: null },
  
  // Historique
  attempt: { type: Number, default: 0 },
  errorMessage: { type: String, default: null },
  
  // Métadonnées
  notes: { type: String }
}, { timestamps: true });

// ============================================
// EXPIRATION ANALYTICS SCHEMA
// ============================================
const ExpirationAnalyticsSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now, index: true },
  
  // Statistiques par type
  byType: {
    isp: {
      total: { type: Number, default: 0 },
      expiring_soon: { type: Number, default: 0 },
      expired: { type: Number, default: 0 },
      renewed: { type: Number, default: 0 }
    },
    residential: {
      total: { type: Number, default: 0 },
      expiring_soon: { type: Number, default: 0 },
      expired: { type: Number, default: 0 },
      renewed: { type: Number, default: 0 }
    },
    datacenter: {
      total: { type: Number, default: 0 },
      expiring_soon: { type: Number, default: 0 },
      expired: { type: Number, default: 0 },
      renewed: { type: Number, default: 0 }
    }
  },
  
  // Statistiques globales
  totalActiveProxies: { type: Number, default: 0 },
  totalExpiringProxies: { type: Number, default: 0 },
  totalExpiredProxies: { type: Number, default: 0 },
  averageRenewalRate: { type: Number, default: 0 }, // en %
  
  // Revenus
  renewalRevenue: { type: Number, default: 0 },
  averageRenewalValue: { type: Number, default: 0 }
}, { timestamps: true });

// ============================================
// INDEXES ET STATICS
// ============================================

// Index pour les requêtes d'expiration
ProxySchema.index({ expiresAt: 1, status: 1 });
ProxySchema.index({ userId: 1, status: 1 });
ProxySchema.index({ type: 1, expiresAt: 1 });

// Statics pour les requêtes courantes
ProxySchema.statics.findExpiringProxies = function(daysFromNow = 7) {
  const fromDate = new Date();
  const toDate = new Date(fromDate.getTime() + daysFromNow * 24 * 60 * 60 * 1000);
  
  return this.find({
    expiresAt: { $gte: fromDate, $lte: toDate },
    status: { $in: ['active', 'expiring_soon'] }
  });
};

ProxySchema.statics.findExpiredProxies = function() {
  return this.find({
    expiresAt: { $lt: new Date() },
    status: { $ne: 'expired' }
  });
};

ProxySchema.statics.findByTypeAndStatus = function(type, status) {
  return this.find({ type, status });
};

ProxySchema.statics.getStatsByType = async function() {
  return this.aggregate([
    {
      $group: {
        _id: '$type',
        total: { $sum: 1 },
        active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
        expiring_soon: { $sum: { $cond: [{ $eq: ['$status', 'expiring_soon'] }, 1, 0] } },
        expired: { $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] } }
      }
    }
  ]);
};

// Instance methods
ProxySchema.methods.getDaysUntilExpiration = function() {
  const now = new Date();
  const daysMs = this.expiresAt.getTime() - now.getTime();
  return Math.ceil(daysMs / (1000 * 60 * 60 * 24));
};

ProxySchema.methods.isExpiringSoon = function(days = 7) {
  return this.getDaysUntilExpiration() <= days && this.getDaysUntilExpiration() > 0;
};

ProxySchema.methods.isExpired = function() {
  return new Date() > this.expiresAt;
};

ProxySchema.methods.renewalCost = function(days, pricing) {
  // Calculer le coût du renouvellement basé sur le type
  const dayPrice = this.type === 'isp' ? 0.15 : this.type === 'residential' ? 0.20 : 0.10;
  return days * dayPrice;
};

ProxySchema.methods.getStatusLabel = function() {
  const labels = {
    active: '✅ Actif',
    expiring_soon: '⏰ Expire bientôt',
    expired: '❌ Expiré',
    renewed: '🔄 Renouvelé',
    cancelled: '🚫 Annulé'
  };
  return labels[this.status] || this.status;
};

// ============================================
// MODELS
// ============================================

const Proxy = mongoose.model('Proxy', ProxySchema);
const ExpirationAlert = mongoose.model('ExpirationAlert', ExpirationAlertSchema);
const ProxyRenewal = mongoose.model('ProxyRenewal', ProxyRenewalSchema);
const ExpirationAnalytics = mongoose.model('ExpirationAnalytics', ExpirationAnalyticsSchema);

module.exports = {
  Proxy,
  ExpirationAlert,
  ProxyRenewal,
  ExpirationAnalytics,
  ProxySchema,
  ExpirationAlertSchema,
  ProxyRenewalSchema,
  ExpirationAnalyticsSchema
};
