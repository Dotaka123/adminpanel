const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- CONFIGURATION ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://rakotoniainalahatra3_db_user:RXy0cKTSWpXtgCUA@cluster0.gzeshjm.mongodb.net/proxyflow?retryWrites=true&w=majority';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || 'EAAI12hLrtqEBQXKdwMnbFTZCdXyEXHVWUsewGrZAK28NrIvSJZAS2mOQt1K7GbrfFdBgjJgtae4LxVaPJ2UPf3c20YAlvZAypZBk7jahFt7qu3wCyuUaIci5IsgI7ovwLXKJQiNUgvTUNjC08ECSv9xir82e8MKDzKMkyAag8ABgrPC3wjkNbGf2gUA5aX4NW9aP5y8S7pRFMiISunGCD0HGYNAZDZD';

mongoose.connect(MONGO_URI).then(() => console.log("✅ DB Admin Connectée"));

// --- MODÈLES ---
const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String,
    orderId: String,
    method: String,
    provider: String,
    paymentRef: String,
    status: { type: String, default: 'EN ATTENTE' },
    proxyData: String,
    expiresAt: Date,
    date: { type: Date, default: Date.now }
}));

const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true },
    email: String,
    balance: { type: Number, default: 0 }
}));

// --- ROUTES ---

app.get('/', (req, res) => res.redirect('/admin/panel'));

app.get('/admin/panel', async (req, res) => {
    try {
        const pendingOrders = await Order.find({ status: 'EN ATTENTE' }).sort({ date: -1 });
        const users = await User.find().sort({ balance: -1 });

        // Calcul Stats
        const totalUsers = users.length;
        const deliveredOrders = await Order.find({ status: 'LIVRÉ' });
        const totalSold = deliveredOrders.length;
        const totalEarnings = totalSold * 4; // 4$ par vente

        res.render('admin', { 
            pendingOrders, 
            users, 
            stats: { totalUsers, totalSold, totalEarnings } 
        });
    } catch (err) {
        res.status(500).send("Erreur : " + err.message);
    }
});

app.post('/admin/deliver', async (req, res) => {
    const { orderId, proxyData } = req.body;
    const expiry = new Date(); expiry.setDate(expiry.getDate() + 30);

    const order = await Order.findOneAndUpdate(
        { orderId },
        { status: 'LIVRÉ', proxyData, expiresAt: expiry },
        { new: true }
    );

    if (order) {
        const msg = `🎉 Commande Validée !\n📍 ISP: ${order.provider}\n🔑 Accès: ${proxyData}\n📅 Expire: ${expiry.toLocaleDateString()}`;
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: order.psid }, message: { text: msg }
        }).catch(e => {});
    }
    res.redirect('/admin/panel');
});

app.post('/admin/add-balance', async (req, res) => {
    const { psid, amount } = req.body;
    await User.findOneAndUpdate({ psid }, { $inc: { balance: parseFloat(amount) } });
    res.redirect('/admin/panel');
});

app.post('/admin/reject', async (req, res) => {
    const { orderId } = req.body;
    const order = await Order.findOneAndUpdate({ orderId }, { status: 'REFUSÉ' });
    if (order) {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: order.psid }, message: { text: `❌ Commande ${orderId} refusée.` }
        }).catch(e => {});
    }
    res.redirect('/admin/panel');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Admin actif sur port ${PORT}`));
