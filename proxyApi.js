// proxyApi.js
const axios = require('axios');

const API_BASE_URL = process.env.API_BASE_URL || 'https://bot.mega-panel.net/api/web/index.php/v1';
const API_EMAIL = process.env.API_EMAIL || 'tonnyignace86@gmail.com';
const API_PASSWORD = process.env.API_PASSWORD || 'rakotoniaina16';

console.log(`\n🔐 Proxy API Config:`);
console.log(`   Base URL: ${API_BASE_URL}`);
console.log(`   Email: ${API_EMAIL}`);
console.log(`   Status: ✅ Prêt\n`);

let authToken = null;
let tokenExpiry = null;

// Obtenir le token JWT
async function getAuthToken() {
    try {
        // Réutiliser le token s'il est encore valide
        if (authToken && tokenExpiry && Date.now() < tokenExpiry) {
            console.log(`♻️  Token réutilisé`);
            return authToken;
        }

        console.log(`\n🔑 Authentification à l'API proxy...`);
        
        const response = await axios.post(`${API_BASE_URL}/login`, {
            email: API_EMAIL,
            password: API_PASSWORD
        }, {
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        authToken = response.data.token;
        
        // Token valide 55 minutes (expiration à 60 min)
        tokenExpiry = Date.now() + (55 * 60 * 1000);

        console.log(`✅ Token JWT obtenu - Valide jusqu'à ${new Date(tokenExpiry).toLocaleTimeString()}\n`);
        return authToken;

    } catch (error) {
        console.error(`\n❌ Erreur authentification:`);
        console.error(`   Status: ${error.response?.status}`);
        console.error(`   Message: ${error.response?.data?.message || error.message}\n`);
        authToken = null;
        tokenExpiry = null;
        throw new Error('Impossible de s\'authentifier à l\'API proxy');
    }
}

async function proxyApiRequest(method, endpoint, data = null, params = {}) {
    try {
        // Obtenir le token
        const token = await getAuthToken();

        const url = `${API_BASE_URL}${endpoint}`;
        
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`
        };

        const config = {
            method: method.toUpperCase(),
            url: url,
            headers: headers,
            params: params,
            timeout: 30000
        };

        if (data) {
            config.data = data;
        }

        console.log(`📤 [${method.toUpperCase()}] ${endpoint}`);
        if (Object.keys(params).length > 0) {
            console.log(`   Params:`, params);
        }
        if (data) {
            console.log(`   Body:`, JSON.stringify(data).substring(0, 100) + '...');
        }

        const response = await axios(config);

        console.log(`✅ Réponse [${response.status}] - ${Array.isArray(response.data) ? response.data.length + ' items' : 'OK'}\n`);

        return response.data;

    } catch (error) {
        const status = error.response?.status;
        const message = error.response?.data?.message || error.response?.data?.error || error.message;
        
        console.error(`\n❌ ProxyAPI Error [${status}]:`);
        console.error(`   Endpoint: ${endpoint}`);
        console.error(`   Message: ${message}\n`);
        
        // Si 401, reset le token pour forcer re-login
        if (status === 401) {
            authToken = null;
            tokenExpiry = null;
        }
        
        throw error;
    }
}

module.exports = { proxyApiRequest };
