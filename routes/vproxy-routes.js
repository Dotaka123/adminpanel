/**
 * vproxy-routes.js — ProxyFlow
 * Intégration API vproxy.cc (Reseller)
 */

const axios = require('axios');

const VPROXY_BASE = 'https://vproxy.cc/reseller-api';

const STICKY_RANGES = {
    residential:         [7000, 7099],
    datacenter:          [7100, 7199],
    residential_premium: [7200, 7249]
};

const ALLOWED_POOLS = ['residential', 'datacenter', 'residential_premium'];

const PRICE_TABLE = {
    residential:         [{ gb:1,price:2.20 },{ gb:5,price:10.50 },{ gb:10,price:19.00 },{ gb:50,price:85.00 },{ gb:100,price:145.00 }],
    datacenter:          [{ gb:1,price:1.20 },{ gb:5,price:5.50  },{ gb:10,price:10.00 },{ gb:50,price:47.00 },{ gb:100,price:85.00  }],
    residential_premium: [{ gb:1,price:5.80 },{ gb:5,price:27.00 },{ gb:10,price:52.00 },{ gb:50,price:250.00},{ gb:100,price:470.00 }]
};

function getPrice(pool, gb) {
    return (PRICE_TABLE[pool] || []).find(r => r.gb === parseInt(gb)) || null;
}

function vpClient() {
    const key = process.env.VPROXY_API_KEY;
    if (!key) throw new Error('VPROXY_API_KEY non definie sur Render');
    return axios.create({
        baseURL: VPROXY_BASE,
        headers: { 'apikey': key, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        timeout: 20000
    });
}

function vpErrMsg(err) {
    const status = err.response?.status;
    const body   = err.response?.data;
    const str    = typeof body === 'object' ? JSON.stringify(body) : String(body || '');
    return `[vproxy HTTP ${status}] ${str || err.message}`;
}

async function ensureSubuser(user, pool) {
    const field = 'vproxySubuserId_' + pool;
    if (user[field]) {
        try { await vpClient().get('/subuser/get?subuser_id=' + user[field]); return user[field]; }
        catch (_) { user[field] = null; }
    }
    const [sMin, sMax] = STICKY_RANGES[pool];
    const resp = await vpClient().post('/subuser/create', {
        pool_type: pool, sticky_range: [sMin, sMax], threads: 50, allowed_ips: [], default_pool_parameters: null
    });
    const newId = typeof resp.data === 'object' ? (resp.data.id || resp.data.subuser_id || resp.data) : resp.data;
    user[field] = newId;
    await user.save();
    return newId;
}

module.exports = function mountVproxyRoutes(app, User, authMiddleware) {

    // DEBUG — appel depuis curl avec ton token admin
    // GET /api/vproxy/debug
    app.get('/api/vproxy/debug', authMiddleware, async (req, res) => {
        if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin uniquement.' });
        const key = process.env.VPROXY_API_KEY;
        const result = {
            VPROXY_API_KEY_definie: !!key,
            VPROXY_API_KEY_debut: key ? key.slice(0, 10) + '...' : 'ABSENTE',
        };
        try {
            const resp = await vpClient().get('/balance/get_full');
            result.vproxy_ok = true;
            result.vproxy_balance = resp.data;
        } catch (err) {
            result.vproxy_ok = false;
            result.vproxy_status = err.response?.status;
            result.vproxy_body = err.response?.data;
            result.vproxy_message = err.message;
        }
        res.json(result);
    });

    app.get('/api/vproxy/pools', authMiddleware, (req, res) => {
        res.json(ALLOWED_POOLS.map(pool => ({
            key: pool,
            name: pool === 'residential' ? 'Residential' : pool === 'datacenter' ? 'Datacenter' : 'Residential Premium',
            volumes: PRICE_TABLE[pool]
        })));
    });

    app.get('/api/vproxy/countries', authMiddleware, async (req, res) => {
        const { pool } = req.query;
        if (!ALLOWED_POOLS.includes(pool)) return res.status(400).json({ error: 'Pool invalide.' });
        try {
            const resp = await vpClient().get('/common/location/country?pool=' + pool + '&order_by=name');
            res.json(resp.data);
        } catch (err) {
            const detail = vpErrMsg(err);
            console.error('[vproxy] countries:', detail);
            res.status(500).json({
                error: 'Erreur vproxy (pays).',
                detail,
                hint: !process.env.VPROXY_API_KEY ? 'VPROXY_API_KEY absente sur Render !' : 'Appelez /api/vproxy/debug (en admin) pour diagnostiquer.'
            });
        }
    });

    app.get('/api/vproxy/cities', authMiddleware, async (req, res) => {
        const { pool, countries } = req.query;
        if (!ALLOWED_POOLS.includes(pool)) return res.status(400).json({ error: 'Pool invalide.' });
        try {
            let url = '/common/location/city?pool=' + pool;
            if (countries) url += '&countries=' + encodeURIComponent(countries);
            const resp = await vpClient().get(url);
            res.json(resp.data);
        } catch (err) {
            const detail = vpErrMsg(err);
            console.error('[vproxy] cities:', detail);
            res.status(500).json({ error: 'Erreur vproxy (villes).', detail });
        }
    });

    app.get('/api/vproxy/reseller-balance', authMiddleware, async (req, res) => {
        if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin requis.' });
        try {
            const resp = await vpClient().get('/balance/get_full');
            res.json(resp.data);
        } catch (err) {
            const detail = vpErrMsg(err);
            console.error('[vproxy] reseller-balance:', detail);
            res.status(500).json({ error: 'Erreur vproxy (solde).', detail });
        }
    });

    app.post('/api/vproxy/buy', authMiddleware, async (req, res) => {
        const { pool, gb, type='rotating', protocol='http', quantity=10, countries='', cities='', sessionttl=300 } = req.body;
        if (!ALLOWED_POOLS.includes(pool)) return res.status(400).json({ error: 'Pool invalide.' });
        const gbInt = parseInt(gb);
        if (!gbInt || gbInt < 1) return res.status(400).json({ error: 'Volume invalide.' });
        if (!['sticky','rotating'].includes(type)) return res.status(400).json({ error: 'Type invalide.' });
        if (!['http','socks5'].includes(protocol)) return res.status(400).json({ error: 'Protocole invalide.' });
        const priceConfig = getPrice(pool, gbInt);
        if (!priceConfig) return res.status(400).json({ error: 'Volume non disponible.' });
        const price = priceConfig.price;
        const qtInt = Math.min(Math.max(parseInt(quantity)||10, 1), 100);

        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
        if (user.balance < price) return res.status(402).json({ error: 'Solde insuffisant.', required: price, balance: user.balance });

        let subuserId;
        try { subuserId = await ensureSubuser(user, pool); }
        catch (err) { return res.status(500).json({ error: 'Impossible de créer le sous-compte vproxy.', detail: vpErrMsg(err) }); }

        try { await vpClient().post('/subuser/balance/add', { subuser_id: subuserId, gb: gbInt }); }
        catch (err) {
            if (err.response?.status === 402) return res.status(402).json({ error: 'Solde revendeur insuffisant.', detail: vpErrMsg(err) });
            return res.status(500).json({ error: "Impossible d'ajouter le volume.", detail: vpErrMsg(err) });
        }

        let proxies = [];
        try {
            const params = new URLSearchParams({ pool, subuser_id: subuserId, type, protocol, format:'plain', quantity: qtInt });
            if (type === 'sticky') params.set('sessionttl', sessionttl);
            if (countries) params.set('countries', countries);
            if (cities) params.set('cities', cities);
            const resp = await vpClient().get('/get-proxy?' + params.toString(), { headers: { accept: 'text/plain' } });
            proxies = typeof resp.data === 'string' ? resp.data.trim().split('\n').filter(Boolean) : [];
        } catch (err) {
            try { await vpClient().post('/subuser/balance/dec', { subuser_id: subuserId, gb: gbInt }); } catch (_) {}
            return res.status(500).json({ error: 'Impossible de récupérer les proxies. Volume remboursé.', detail: vpErrMsg(err) });
        }

        if (!proxies.length) {
            try { await vpClient().post('/subuser/balance/dec', { subuser_id: subuserId, gb: gbInt }); } catch (_) {}
            return res.status(500).json({ error: 'Aucun proxy disponible. Volume remboursé.' });
        }

        const balanceBefore = user.balance;
        user.balance = parseFloat((user.balance - price).toFixed(2));
        await user.save();

        try {
            const Transaction = require('mongoose').model('Transaction');
            await new Transaction({ userId: user._id, type:'purchase', amount:price,
                description: 'Proxy ' + pool + ' ' + gbInt + 'GB · ' + type + ' · ' + protocol.toUpperCase(),
                balanceBefore, balanceAfter: user.balance,
                proxyDetails: { pool, gb: gbInt, type, protocol, quantity: proxies.length, subuserId }
            }).save();
        } catch (txErr) { console.error('[vproxy] Transaction save:', txErr.message); }

        res.json({ success:true, pool, type, protocol, gb:gbInt, price, userBalance:user.balance, proxies, subuserId, message: proxies.length + ' proxies livrés.' });
    });

    app.post('/api/vproxy/refresh', authMiddleware, async (req, res) => {
        const { pool, type='rotating', protocol='http', quantity=10, countries='', sessionttl=300 } = req.body;
        if (!ALLOWED_POOLS.includes(pool)) return res.status(400).json({ error: 'Pool invalide.' });
        const user = await User.findById(req.user._id);
        const field = 'vproxySubuserId_' + pool;
        if (!user?.[field]) return res.status(400).json({ error: 'Achetez du volume d\'abord.' });
        try {
            const params = new URLSearchParams({ pool, subuser_id: user[field], type, protocol, format:'plain', quantity: Math.min(parseInt(quantity)||10, 100) });
            if (type === 'sticky') params.set('sessionttl', sessionttl);
            if (countries) params.set('countries', countries);
            const resp = await vpClient().get('/get-proxy?' + params.toString(), { headers: { accept: 'text/plain' } });
            const proxies = typeof resp.data === 'string' ? resp.data.trim().split('\n').filter(Boolean) : [];
            res.json({ success:true, proxies });
        } catch (err) {
            res.status(500).json({ error: 'Impossible de régénérer.', detail: vpErrMsg(err) });
        }
    });

    app.get('/api/vproxy/my-balance', authMiddleware, async (req, res) => {
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
        const results = {};
        for (const pool of ALLOWED_POOLS) {
            const field = 'vproxySubuserId_' + pool;
            if (!user[field]) { results[pool] = null; continue; }
            try { const resp = await vpClient().get('/subuser/balance/get?subuser_id=' + user[field]); results[pool] = resp.data; }
            catch (_) { results[pool] = null; }
        }
        res.json(results);
    });

    app.get('/api/vproxy/admin/subusers', authMiddleware, async (req, res) => {
        if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin requis.' });
        try {
            const resp = await vpClient().get('/subuser/list?limit=1000&offset=0');
            res.json(resp.data);
        } catch (err) {
            res.status(500).json({ error: err.message, detail: vpErrMsg(err) });
        }
    });

    console.log('✅ vproxy-routes monté');
};
