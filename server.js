const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');

const app = express();

// --- CONFIGURATION ---
// Assure-toi que ces variables sont bien dans les "Environment Variables" sur Render
const MONGO_URI = process.env.MONGO_URI;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- CONNEXION BDD ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Admin Dashboard connecté à MongoDB"))
    .catch(err => console.error("❌ Erreur de connexion MongoDB:", err));

// --- MODÈLES (Doivent être identiques à ceux du Bot) ---
const User = mongoose.model('User', new mongoose.Schema({
    psid: String, email: String, balance: { type: Number, default: 0 }
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, orderId: String, provider: String, price: Number,
    status: { type: String, default: 'EN ATTENTE' }, proxyData: String, date: { type: Date, default: Date.now }
}));

const Settings = mongoose.model('Settings', new mongoose.Schema({
    key: String, value: String
}));

// --- ROUTES ---

// 1. PAGE PRINCIPALE (Affiche les stats, les commandes et les utilisateurs)
app.get('/admin/panel', async (req, res) => {
    try {
        // 1. Fetch data
        const users = await User.find({ email: { $exists: true } }).sort({ balance: -1 });
        const rawOrders = await Order.find({ status: { $regex: /PENDING|EN ATTENTE/i } }).sort({ date: -1 });
        const deliveredOrders = await Order.find({ status: /LIVRÉ|DELIVERED/i });

        // 2. Map PSID to Email for easy reading
        const pending = await Promise.all(rawOrders.map(async (order) => {
            const user = await User.findOne({ psid: order.psid });
            return {
                ...order._doc,
                customerEmail: user ? user.email : "Guest/Unknown"
            };
        }));

        // 3. Stats calculation
        const earnings = deliveredOrders.reduce((acc, o) => acc + (o.price || 0), 0);

        // 4. Send to EJS
        res.render('admin', { 
            pending, 
            users, 
            stats: { 
                u: users.length, 
                s: deliveredOrders.length, 
                g: earnings.toFixed(2) 
            } 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error: " + err.message);
    }
});

// 2. LIVRAISON DE LA COMMANDE
app.post('/admin/deliver', async (req, res) => {
    const { orderId, proxyData } = req.body;
    try {
        const order = await Order.findOneAndUpdate(
            { orderId }, 
            { status: 'LIVRÉ', proxyData }, 
            { new: true }
        );

        if (order) {
            // Envoi automatique du message de livraison au client sur Messenger
            await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
                recipient: { id: order.psid },
                message: { 
                    text: `✅ LIVRAISON RÉUSSIE !\n\nCommande: ${order.provider}\nVos Proxies (0 Fraud Score):\n${proxyData}\n\nMerci de votre confiance !` 
                }
            });
        }
        res.redirect('/admin/panel');
    } catch (err) {
        res.status(500).send("Erreur lors de la livraison.");
    }
});

// 3. AJOUTER DU SOLDE À UN CLIENT MANUELLEMENT
app.post('/admin/add-balance', async (req, res) => {
    const { psid, amount } = req.body;
    try {
        await User.findOneAndUpdate({ psid }, { $inc: { balance: parseFloat(amount) } });
        res.redirect('/admin/panel');
    } catch (err) {
        res.status(500).send("Erreur lors de l'ajout de solde.");
    }
});

// 4. METTRE À JOUR LES FREE PROXIES (Sans redémarrer le bot)
app.post('/admin/update-free', async (req, res) => {
    const { freeContent } = req.body;
    try {
        await Settings.findOneAndUpdate(
            { key: 'free_proxies' }, 
            { value: freeContent }, 
            { upsert: true }
        );
        res.redirect('/admin/panel');
    } catch (err) {
        res.status(500).send("Erreur lors de la mise à jour des free proxies.");
    }
});

// Lancement du serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Admin Dashboard sur le port ${PORT}`));
