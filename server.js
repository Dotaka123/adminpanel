const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

// --- CONFIGURATION ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://rakotoniainalahatra3_db_user:RXy0cKTSWpXtgCUA@cluster0.gzeshjm.mongodb.net/proxyflow?retryWrites=true&w=majority';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

mongoose.connect(MONGO_URI).then(() => console.log("✅ DB Admin Connectée"));

// --- MODÈLES ---
const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, orderId: String, method: String, provider: String,
    price: Number, status: { type: String, default: 'EN ATTENTE' },
    paymentRef: String, proxyData: String, expiresAt: Date, date: { type: Date, default: Date.now }
}));

const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true }, email: String, balance: { type: Number, default: 0 }
}));

// --- ROUTES ---

app.get('/', (req, res) => res.redirect('/admin/panel'));

app.get('/admin/panel', async (req, res) => {
    try {
        const lang = req.query.lang === 'en' ? 'en' : 'fr';
        
        // On récupère uniquement les vrais inscrits (avec email)
        const users = await User.find({ email: { $exists: true } }).sort({ balance: -1 });
        const pendingOrders = await Order.find({ status: 'EN ATTENTE' }).sort({ date: -1 });
        
        // CALCUL DES GAINS RÉELS (Somme des prix des commandes livrées)
        const delivered = await Order.find({ status: 'LIVRÉ' });
        const totalEarnings = delivered.reduce((acc, o) => acc + (o.price || 0), 0);

        const stats = { 
            totalUsers: users.length, 
            totalSold: delivered.length, 
            totalEarnings: totalEarnings.toFixed(2) 
        };

        const translations = {
            fr: { title: "Contrôle ProxyFlow", st_u: "Utilisateurs", st_s: "Ventes", st_g: "Gains", t_pend: "Commandes en attente", t_user: "Utilisateurs", c_pay: "Réf. Paiement", c_bal: "Solde", b_del: "Livrer ✅", b_cre: "Créditer", b_deb: "Débiter" },
            en: { title: "ProxyFlow Control", st_u: "Users", st_s: "Sold", st_g: "Earnings", t_pend: "Pending Orders", t_user: "User List", c_pay: "Payment Ref", c_bal: "Balance", b_del: "Deliver ✅", b_cre: "Credit", b_deb: "Debit" }
        };

        res.render('admin', { pendingOrders, users, stats, t: translations[lang], currentLang: lang });
    } catch (err) {
        res.status(500).send("Error: " + err.message);
    }
});

// Route Créditer
app.post('/admin/add-balance', async (req, res) => {
    await User.findOneAndUpdate({ psid: req.body.psid }, { $inc: { balance: parseFloat(req.body.amount) } });
    res.redirect('back');
});

// Route Débiter
app.post('/admin/sub-balance', async (req, res) => {
    await User.findOneAndUpdate({ psid: req.body.psid }, { $inc: { balance: -parseFloat(req.body.amount) } });
    res.redirect('back');
});

// Route Livraison
app.post('/admin/deliver', async (req, res) => {
    const { orderId, proxyData } = req.body;
    const expiry = new Date(); expiry.setDate(expiry.getDate() + 30);
    const order = await Order.findOneAndUpdate({ orderId }, { status: 'LIVRÉ', proxyData, expiresAt: expiry }, { new: true });
    
    if (order) {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: order.psid }, 
            message: { text: `✅ Order Validated!\n📍 ISP: ${order.provider}\n🔑 Data: ${proxyData}\n📅 Expires: ${expiry.toLocaleDateString()}` }
        }).catch(e => console.log("Erreur Notification FB"));
    }
    res.redirect('back');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Admin actif sur port ${PORT}`));
