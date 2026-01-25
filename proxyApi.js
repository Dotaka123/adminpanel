// proxyApi.js
const axios = require('axios');

const API_BASE_URL = process.env.API_BASE_URL;
const PROXY_ADMIN_EMAIL = process.env.API_EMAIL; // tonnyignace86
const PROXY_ADMIN_PASSWORD = process.env.API_PASSWORD;

let authToken = null;
let tokenExpireAt = 0;

async function getProxyToken() {
  const now = Math.floor(Date.now() / 1000);
  
  // Si token valide et pas presque expiré (300s)
  if (authToken && tokenExpireAt > now + 300) {
    return authToken;
  }

  console.log(`🔑 Login API proxy avec: ${PROXY_ADMIN_EMAIL}`);
  
  try {
    const response = await axios.post(`${API_BASE_URL}/login`, {
      email: PROXY_ADMIN_EMAIL,
      password: PROXY_ADMIN_PASSWORD
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });

    authToken = response.data.token;
    tokenExpireAt = response.data.expire_at;
    
    console.log(`✅ Token admin obtenu (expire à ${tokenExpireAt})`);
    return authToken;
  } catch (error) {
    console.error('❌ Erreur login API proxy:', error.response?.data || error.message);
    throw error;
  }
}

async function proxyApiRequest(method, endpoint, data = null, params = null) {
  const token = await getProxyToken();
  
  const config = {
    method,
    url: `${API_BASE_URL}${endpoint}`,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  };

  if (data) config.data = data;
  if (params) config.params = params;

  try {
    const response = await axios(config);
    return response.data;
  } catch (error) {
    // Si token expiré, réessaye avec nouveau token
    if (error.response?.status === 401) {
      console.log('⚠️  Token expiré, renouvellement...');
      authToken = null;
      const newToken = await getProxyToken();
      config.headers.Authorization = `Bearer ${newToken}`;
      const response = await axios(config);
      return response.data;
    }
    
    console.error(`❌ Erreur API (${error.response?.status}):`, error.response?.data || error.message);
    throw error;
  }
}

module.exports = { proxyApiRequest, getProxyToken };
