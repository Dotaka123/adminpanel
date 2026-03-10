/**
 * vproxy-routes.js
 * Intégration API vproxy.cc (Reseller) pour ProxyFlow
 *
 * Usage dans server.js (après définition de app, User, authMiddleware) :
 *   const mountVproxy = require('./vproxy-routes');
 *   mountVproxy(app, User, authMiddleware);
 *
 * Variable d'env requise :
 *   VPROXY_API_KEY  — clé API vproxy.cc
 *
 * Pools pris en charge : residential, datacenter, residential_premium
 * Exclus volontairement : mobile, ISP (commandes manuelles)
 */

const axios = require('axios');

const VPROXY_BASE = 'https://vproxy.cc/reseller-api';

// Taux de conversion : combien de GB vproxy on consomme pour 1 GB acheté
const POOL_CONV = {
    residential:         1,
    datacenter:          0.5,
    residential_premium: 4
};

// Plages sticky par pool (évite les conflits inter-subusers)
const STICKY_RANGES = {
    residential:         [7000, 7099],
    datacenter:          [7100, 7199],
    residential_premium: [7200, 7249]
};

const ALLOWED_POOLS = ['residential', 'datacenter', 'residential_premium'];

// Table de prix locale (doit correspondre à ce qu'affiche le frontend)
const PRICE_TABLE = {
    residential: [
        { gb: 1,   price: 2.20  },
        { gb: 5,   price: 10.50 },
        { gb: 10,  price: 19.00 },
        { gb: 50,  price: 85.00 },
        { gb: 100, price: 145.00 }
    ],
    datacenter: [
        { gb: 1,   price: 1.20  },
        { gb: 5,   price: 5.50  },
        { gb: 10,  price: 10.00 },
        { gb: 50,  price: 47.00 },
        { gb: 100, price: 85.00 }
    ],
    residential_premium: [
        { gb: 1,   price: 5.80  },
        { gb: 5,   price: 27.00 },
        { gb: 10,  price: 52.00 },
        { gb: 50,  price: 250.00 },
        { gb: 100, price: 470.00 }
    ]
};

function getPrice(pool, gb) {
    return (PRICE_TABLE[pool] || []).find(r => r.gb === parseInt(gb)) || null;
}

// ─── Client axios vproxy ──────────────────────────────────────────────────────
function vpApi() {
    const key = process.env.VPROXY_API_KEY;
    if (!key) throw new Error('VPROXY_API_KEY manquant dans .env');
    return axios.create({
        baseURL: VPROXY_BASE,
        headers: { apikey: key, 'Content-Type': 'application/json' },
        timeout: 15000
    });
}

// ─── Créer ou récupérer le subuser vproxy de l'utilisateur ───────────────────
async function ensureSubuser(user, pool) {
    const field = `vproxySubuserId_${pool}`;

    if (user[field]) {
        // Vérifier que le subuser existe encore
        try {
            await vpApi().get(`/subuser/get?subuser_id=${user[field]}`);
            return user[field];
        } catch (_) {
            user[field] = null; // invalide → recréer
        }
    }

    const [sMin, sMax] = STICKY_RANGES[pool];
    const resp = await vpApi().post('/subuser/create', {
        pool_type:    pool,
        sticky_range: [sMin, sMax],
        threads:      50,
        allowed_ips:  [],
        default_pool_parameters: null
    });

    const newId = resp.data; // L'API retourne l'ID directement
    user[field] = newId;
    await user.save();
    return newId;
}

// ─── Module principal ─────────────────────────────────────────────────────────
module.exports = function mountVproxyRoutes(app, User, authMiddleware) {

    // ── 1. Lister les pools disponibles ─────────────────────────────────────
    app.get('/api/vproxy/pools', authMiddleware, (req, res) => {
        res.json(
            ALLOWED_POOLS.map(pool => ({
                key:      pool,
                name:     pool === 'residential'         ? 'Residential'
                        : pool === 'datacenter'          ? 'Datacenter'
                        :                                  'Residential Premium',
                volumes:  PRICE_TABLE[pool],
                convRate: POOL_CONV[pool]
            }))
        );
    });

    // ── 2. Pays disponibles pour un pool ────────────────────────────────────
    app.get('/api/vproxy/countries', authMiddleware, async (req, res) => {
        const { pool } = req.query;
        if (!ALLOWED_POOLS.includes(pool))
            return res.status(400).json({ error: 'Pool invalide.' });
        try {
            const resp = await vpApi().get(`/common/location/country?pool=${pool}&order_by=name`);
            res.json(resp.data);
        } catch (err) {
            res.status(500).json({ error: 'Impossible de récupérer les pays.', detail: err.message });
        }
    });

    // ── 3. Villes disponibles pour un pool ──────────────────────────────────
    app.get('/api/vproxy/cities', authMiddleware, async (req, res) => {
        const { pool, countries } = req.query;
        if (!ALLOWED_POOLS.includes(pool))
            return res.status(400).json({ error: 'Pool invalide.' });
        try {
            let url = `/common/location/city?pool=${pool}`;
            if (countries) url += `&countries=${encodeURIComponent(countries)}`;
            const resp = await vpApi().get(url);
            res.json(resp.data);
        } catch (err) {
            res.status(500).json({ error: 'Impossible de récupérer les villes.' });
        }
    });

    // ── 4. Solde revendeur vproxy (admin) ────────────────────────────────────
    app.get('/api/vproxy/reseller-balance', authMiddleware, async (req, res) => {
        if (!req.user.isAdmin)
            return res.status(403).json({ error: 'Accès refusé — Admin requis.' });
        try {
            const resp = await vpApi().get('/balance/get_full');
            res.json(resp.data);
        } catch (err) {
            res.status(500).json({ error: 'Impossible de récupérer le solde vproxy.' });
        }
    });

    // ── 5. Achat de proxies (livraison instantanée) ──────────────────────────
    /**
     * POST /api/vproxy/buy
     * Body: { pool, gb, type?, protocol?, quantity?, countries?, cities?, sessionttl? }
     */
    app.post('/api/vproxy/buy', authMiddleware, async (req, res) => {
        const {
            pool,
            gb,
            type       = 'rotating',
            protocol   = 'http',
            quantity   = 10,
            countries  = '',
            cities     = '',
            sessionttl = 300
        } = req.body;

        // Validation basique
        if (!ALLOWED_POOLS.includes(pool))
            return res.status(400).json({ error: 'Pool invalide. Choisissez : residential, datacenter ou residential_premium.' });

        const gbInt = parseInt(gb);
        if (!gbInt || gbInt < 1)
            return res.status(400).json({ error: 'Volume invalide (minimum 1 Go).' });

        if (!['sticky', 'rotating'].includes(type))
            return res.status(400).json({ error: 'Type invalide : sticky ou rotating.' });

        if (!['http', 'socks5'].includes(protocol))
            return res.status(400).json({ error: 'Protocole invalide : http ou socks5.' });

        const qtInt = Math.min(Math.max(parseInt(quantity) || 10, 1), 100);

        // Prix
        const priceConfig = getPrice(pool, gbInt);
        if (!priceConfig)
            return res.status(400).json({ error: `Volume ${gbInt} GB non disponible pour le pool ${pool}.` });

        const price = priceConfig.price;

        // Solde utilisateur
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

        if (user.balance < price)
            return res.status(402).json({
                error: `Solde insuffisant. Vous avez $${user.balance.toFixed(2)}, il faut $${price.toFixed(2)}.`,
                required: price,
                balance: user.balance
            });

        // Subuser vproxy
        let subuserId;
        try {
            subuserId = await ensureSubuser(user, pool);
        } catch (err) {
            console.error('[vproxy] ensureSubuser error:', err.message);
            return res.status(500).json({ error: 'Impossible de préparer le compte proxy. Vérifiez VPROXY_API_KEY.' });
        }

        // Ajouter le volume au subuser
        try {
            await vpApi().post('/subuser/balance/add', { subuser_id: subuserId, gb: gbInt });
        } catch (err) {
            const code = err.response?.data?.code;
            if (code === 'PT402')
                return res.status(402).json({ error: 'Solde revendeur vproxy insuffisant. Contactez le support.' });
            console.error('[vproxy] balance/add error:', err.response?.data || err.message);
            return res.status(500).json({ error: "Impossible d'ajouter le volume sur vproxy." });
        }

        // Récupérer les proxies
        let proxies = [];
        try {
            const params = new URLSearchParams({
                pool,
                subuser_id: subuserId,
                type,
                protocol,
                format:   'plain',
                quantity: qtInt,
            });
            if (type === 'sticky') params.set('sessionttl', sessionttl);
            if (countries) params.set('countries', countries);
            if (cities)    params.set('cities', cities);

            const resp = await vpApi().get(`/get-proxy?${params.toString()}`, {
                headers: { accept: 'text/plain' }
            });

            proxies = typeof resp.data === 'string'
                ? resp.data.trim().split('\n').filter(Boolean)
                : [];
        } catch (err) {
            // Rembourser le volume
            try { await vpApi().post('/subuser/balance/dec', { subuser_id: subuserId, gb: gbInt }); } catch (_) {}
            console.error('[vproxy] get-proxy error:', err.message);
            return res.status(500).json({ error: 'Impossible de récupérer les proxies. Volume remboursé.' });
        }

        if (!proxies.length) {
            try { await vpApi().post('/subuser/balance/dec', { subuser_id: subuserId, gb: gbInt }); } catch (_) {}
            return res.status(500).json({ error: 'Aucun proxy disponible pour cette sélection. Volume remboursé.' });
        }

        // Déduire le solde
        const balanceBefore = user.balance;
        user.balance = parseFloat((user.balance - price).toFixed(2));
        await user.save();

        // Enregistrer la transaction (utilise le modèle Transaction existant)
        try {
            const Transaction = require('mongoose').model('Transaction');
            await new Transaction({
                userId:        user._id,
                type:          'purchase',
                amount:        price,
                description:   `Proxy ${pool} ${gbInt}GB · ${type} · ${protocol.toUpperCase()}`,
                balanceBefore,
                balanceAfter:  user.balance,
                proxyDetails:  { pool, gb: gbInt, type, protocol, quantity: proxies.length, subuserId }
            }).save();
        } catch (txErr) {
            console.error('[vproxy] Transaction save error:', txErr.message);
        }

        res.json({
            success:     true,
            pool,
            type,
            protocol,
            gb:          gbInt,
            price,
            userBalance: user.balance,
            proxies,
            subuserId,
            message:     `${proxies.length} proxies livrés.`
        });
    });

    // ── 6. Régénérer des proxies (sans nouvel achat) ─────────────────────────
    /**
     * POST /api/vproxy/refresh
     * Body: { pool, type?, protocol?, quantity?, countries?, sessionttl? }
     */
    app.post('/api/vproxy/refresh', authMiddleware, async (req, res) => {
        const { pool, type = 'rotating', protocol = 'http', quantity = 10, countries = '', sessionttl = 300 } = req.body;

        if (!ALLOWED_POOLS.includes(pool))
            return res.status(400).json({ error: 'Pool invalide.' });

        const user = await User.findById(req.user._id);
        const field = `vproxySubuserId_${pool}`;
        if (!user || !user[field])
            return res.status(400).json({ error: 'Aucun compte proxy pour ce pool. Achetez d\'abord du volume.' });

        try {
            const params = new URLSearchParams({
                pool,
                subuser_id: user[field],
                type,
                protocol,
                format:   'plain',
                quantity: Math.min(parseInt(quantity) || 10, 100)
            });
            if (type === 'sticky') params.set('sessionttl', sessionttl);
            if (countries) params.set('countries', countries);

            const resp = await vpApi().get(`/get-proxy?${params.toString()}`, {
                headers: { accept: 'text/plain' }
            });

            const proxies = typeof resp.data === 'string'
                ? resp.data.trim().split('\n').filter(Boolean)
                : [];

            res.json({ success: true, proxies });
        } catch (err) {
            res.status(500).json({ error: 'Impossible de régénérer les proxies.' });
        }
    });

    // ── 7. Solde proxy restant d'un utilisateur ──────────────────────────────
    app.get('/api/vproxy/my-balance', authMiddleware, async (req, res) => {
        const results = {};
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

        for (const pool of ALLOWED_POOLS) {
            const field = `vproxySubuserId_${pool}`;
            if (!user[field]) { results[pool] = null; continue; }
            try {
                const resp = await vpApi().get(`/subuser/balance/get?subuser_id=${user[field]}`);
                results[pool] = resp.data;
            } catch (_) {
                results[pool] = null;
            }
        }
        res.json(results);
    });

    // ── 8. Admin : liste des subusers vproxy ─────────────────────────────────
    app.get('/api/vproxy/admin/subusers', authMiddleware, async (req, res) => {
        if (!req.user.isAdmin)
            return res.status(403).json({ error: 'Accès refusé.' });
        try {
            const resp = await vpApi().get('/subuser/list?limit=1000&offset=0');
            res.json(resp.data);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    console.log('✅ vproxy-routes monté (residential, datacenter, residential_premium)');
};
