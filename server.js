const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

const MONGO_URI = process.env.MONGO_URI || 'ton_lien_mongodb';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || 'ton_token_fb';

mongoose.connect(MONGO_URI).then(() => console.log("✅ DB Admin Connectée"));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, orderId: String, method: String, provider: String,
    paymentRef: String, status: { type: String, default: 'EN ATTENTE' },
    proxyData: String, expiresAt: Date, date: { type: Date, default: Date.now }
}));

const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true }, email: String, balance: { type: Number, default: 0 }
}));

app.get('/', (req, res) => res.redirect('/admin/panel'));

app.get('/admin/panel', async (req, res) => {
    const lang = req.query.lang === 'en' ? 'en' : 'fr';
    const pendingOrders = await Order.find({ status: 'EN ATTENTE' }).sort({ date: -1 });
    const users = await User.find().sort({ balance: -1 });
    const delivered = await Order.find({ status: 'LIVRÉ' });
    
    const stats = { totalUsers: users.length, totalSold: delivered.length, totalEarnings: delivered.length * 4 };
    
    const translations = {
        fr: { title: "Contrôle ProxyFlow", st_u: "Utilisateurs", st_s: "Ventes", st_g: "Gains", t_pend: "Commandes en attente", t_user: "Utilisateurs", c_pay: "Paiement", c_bal: "Solde", b_del: "Livrer ✅", b_cre: "Créditer", b_deb: "Débiter" },
        en: { title: "ProxyFlow Control", st_u: "Users", st_s: "Sold", st_g: "Earnings", t_pend: "Pending Orders", t_user: "Users List", c_pay: "Payment ID", c_bal: "Balance", b_del: "Deliver ✅", b_cre: "Credit", b_deb: "Debit" }
    };

    res.render('admin', { pendingOrders, users, stats, t: translations[lang], currentLang: lang });
});

app.post('/admin/add-balance', async (req, res) => {
    await User.findOneAndUpdate({ psid: req.body.psid }, { $inc: { balance: parseFloat(req.body.amount) } });
    res.redirect('back');
});

app.post('/admin/sub-balance', async (req, res) => {
    await User.findOneAndUpdate({ psid: req.body.psid }, { $inc: { balance: -parseFloat(req.body.amount) } });
    res.redirect('back');
});

app.post('/admin/deliver', async (req, res) => {
    const { orderId, proxyData } = req.body;
    const expiry = new Date(); expiry.setDate(expiry.getDate() + 30);
    const order = await Order.findOneAndUpdate({ orderId }, { status: 'LIVRÉ', proxyData, expiresAt: expiry }, { new: true });
    if (order) {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: order.psid }, message: { text: `✅ Proxy Validated!\n📍 ISP: ${order.provider}\n🔑 Access: ${proxyData}\n📅 Expire: ${expiry.toLocaleDateString()}` }
        });
    }
    res.redirect('back');
});

app.listen(process.env.PORT || 3000);
