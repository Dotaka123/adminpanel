const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

// --- CONFIGURATION ---
const MONGO_URI = process.env.MONGO_URI;
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
        const users = await User.find({ email: { $exists: true } }).sort({ balance: -1 });
        const pendingOrders = await Order.find({ status: 'EN ATTENTE' }).sort({ date: -1 });
        const delivered = await Order.find({ status: 'LIVRÉ' });
        
        // Calcul des gains réels
        const totalEarnings = delivered.reduce((acc, o) => acc + (o.price || 0), 0);

        const t = {
            fr: { title: "ProxyFlow Control", st_u: "Users", st_s: "Ventes", st_g: "Gains", t_pend: "En attente", t_user: "Utilisateurs", c_pay: "Ref", b_del: "Livrer ✅", b_ref: "Refuser ✖" },
            en: { title: "ProxyFlow Control", st_u: "Users", st_s: "Sold", st_g: "Earnings", t_pend: "Pending", t_user: "User List", c_pay: "Ref", b_del: "Deliver ✅", b_ref: "Decline ✖" }
        }[lang];

        res.render('admin', { pendingOrders, users, stats: { u: users.length, s: delivered.length, g: totalEarnings.toFixed(2) }, t, currentLang: lang });
    } catch (e) { res.status(500).send(e.message); }
});

// ACTIONS
app.post('/admin/add-balance', async (req, res) => {
    await User.findOneAndUpdate({ psid: req.body.psid }, { $inc: { balance: parseFloat(req.body.amount) } });
    res.redirect('back');
});

app.post('/admin/deliver', async (req, res) => {
    const { orderId, proxyData } = req.body;
    const expiry = new Date(); expiry.setDate(expiry.getDate() + 30);
    const order = await Order.findOneAndUpdate({ orderId }, { status: 'LIVRÉ', proxyData, expiresAt: expiry }, { new: true });
    if (order) {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: order.psid }, message: { text: `✅ Order Delivered!\nISP: ${order.provider}\nProxy: ${proxyData}\nExpires: ${expiry.toLocaleDateString()}` }
        }).catch(() => {});
    }
    res.redirect('back');
});

app.post('/admin/cancel', async (req, res) => {
    const { orderId, reason } = req.body;
    const order = await Order.findOneAndUpdate({ orderId }, { status: 'REFUSÉ' }, { new: true });
    if (order) {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: order.psid }, message: { text: `❌ Order Declined!\nID: ${order.orderId}\nReason: ${reason || "Invalid Payment."}` }
        }).catch(() => {});
    }
    res.redirect('back');
});

app.listen(process.env.PORT || 3000);
