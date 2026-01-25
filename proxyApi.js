const axios = require('axios');

// Configuration de base
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.example.com';
const API_USERNAME = process.env.API_USERNAME || '';
const API_PASSWORD = process.env.API_PASSWORD || '';

// Instance Axios avec authentification de base
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  auth: {
    username: API_USERNAME,
    password: API_PASSWORD
  },
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': 'ProxyShop/1.0'
  }
});

// Intercepteur pour les erreurs
apiClient.interceptors.response.use(
  response => response,
  error => {
    const errorData = error.response?.data || error.message;
    console.error(`❌ API Error [${error.response?.status || 'UNKNOWN'}]:`, errorData);
    throw error;
  }
);

/**
 * Effectue une requête API vers le service proxy externe
 * @param {string} method - GET, POST, PUT, DELETE
 * @param {string} endpoint - /countries, /proxies, etc.
 * @param {object} data - Données à envoyer (pour POST/PUT)
 * @param {object} params - Paramètres de query (pour GET)
 * @returns {Promise} Réponse de l'API
 */
async function proxyApiRequest(method, endpoint, data = null, params = null) {
  try {
    const config = {
      method: method.toUpperCase(),
      url: endpoint
    };

    // Ajoute les paramètres de query si présents
    if (params) {
      config.params = params;
    }

    // Ajoute les données du body si présentes (POST/PUT)
    if (data && (method.toUpperCase() === 'POST' || method.toUpperCase() === 'PUT')) {
      config.data = data;
    }

    console.log(`📤 [${method.toUpperCase()}] ${endpoint}`, params ? `?${new URLSearchParams(params)}` : '');
    
    const response = await apiClient(config);
    console.log(`✅ Réponse reçue [${response.status}]`);
    
    return response.data;
  } catch (error) {
    const statusCode = error.response?.status;
    const errorMsg = error.response?.data?.message || error.message;
    
    console.error(`❌ Erreur API (${statusCode}):`, error.response?.data || errorMsg);
    
    throw error;
  }
}

/**
 * Récupère la liste des pays disponibles
 * @param {number} pkgId - Package ID (1 = golden, 2 = silver)
 * @returns {Promise<Array>}
 */
async function getCountries(pkgId) {
  try {
    return await proxyApiRequest('GET', '/countries', null, { pkg_id: pkgId });
  } catch (error) {
    console.error('Erreur getCountries:', error.message);
    return [];
  }
}

/**
 * Récupère la liste des villes pour un pays
 * @param {number} countryId - Country ID
 * @param {number} pkgId - Package ID
 * @returns {Promise<Array>}
 */
async function getCities(countryId, pkgId) {
  try {
    return await proxyApiRequest('GET', '/cities', null, { 
      country_id: countryId,
      pkg_id: pkgId 
    });
  } catch (error) {
    console.error('Erreur getCities:', error.message);
    return [];
  }
}

/**
 * Récupère les fournisseurs de service pour une ville
 * @param {number} cityId - City ID
 * @param {number} pkgId - Package ID
 * @returns {Promise<Array>}
 */
async function getServiceProviders(cityId, pkgId) {
  try {
    return await proxyApiRequest('GET', '/service-providers', null, { 
      city_id: cityId,
      pkg_id: pkgId 
    });
  } catch (error) {
    console.error('Erreur getServiceProviders:', error.message);
    return [];
  }
}

/**
 * Récupère la liste des proxies parents disponibles
 * @param {number} pkgId - Package ID
 * @param {number} offset - Décalage pour pagination
 * @param {number} serviceProviderCityId - Service provider city ID (optionnel)
 * @returns {Promise<Array>}
 */
async function getParentProxies(pkgId, offset = 0, serviceProviderCityId = null) {
  try {
    const params = { 
      pkg_id: pkgId,
      offset: offset 
    };

    if (serviceProviderCityId) {
      params.service_provider_city_id = serviceProviderCityId;
    }

    const data = await proxyApiRequest('GET', '/parent-proxies', null, params);
    
    // Normalise la réponse (peut être un array ou un objet avec liste)
    if (Array.isArray(data)) return data;
    if (data?.list) return data.list;
    if (data?.data) return data.data;
    if (data?.proxies) return data.proxies;
    
    return [];
  } catch (error) {
    console.error('Erreur getParentProxies:', error.message);
    return [];
  }
}

/**
 * Crée un proxy auprès du service externe
 * @param {object} proxyData - Données du proxy
 *   - parent_proxy_id: numéro du proxy parent
 *   - package_id: 1 ou 2
 *   - protocol: 'http' ou 'socks5'
 *   - duration: nombre de jours
 *   - username: (optionnel)
 *   - password: (optionnel)
 *   - ip_addr: (optionnel pour golden)
 * @returns {Promise<object>}
 */
async function createProxy(proxyData) {
  try {
    // Valide les données obligatoires
    if (!proxyData.parent_proxy_id || !proxyData.package_id || !proxyData.protocol || !proxyData.duration) {
      throw new Error('Données obligatoires manquantes: parent_proxy_id, package_id, protocol, duration');
    }

    console.log('📤 Création proxy:', {
      parent_proxy_id: proxyData.parent_proxy_id,
      package_id: proxyData.package_id,
      protocol: proxyData.protocol,
      duration: proxyData.duration
    });

    const response = await proxyApiRequest('POST', '/proxies', proxyData);
    
    console.log('✅ Proxy créé avec succès:', {
      id: response.id,
      host: response.ip_addr || response.host,
      port: response.port,
      username: response.username
    });

    return response;
  } catch (error) {
    console.error('Erreur createProxy:', error.message);
    throw error;
  }
}

/**
 * Renew un proxy existant
 * @param {number} proxyId - ID du proxy
 * @param {number} duration - Nombre de jours
 * @returns {Promise<object>}
 */
async function renewProxy(proxyId, duration) {
  try {
    return await proxyApiRequest('POST', `/proxies/${proxyId}/renew`, {
      duration: duration
    });
  } catch (error) {
    console.error('Erreur renewProxy:', error.message);
    throw error;
  }
}

/**
 * Supprime un proxy
 * @param {number} proxyId - ID du proxy
 * @returns {Promise<object>}
 */
async function deleteProxy(proxyId) {
  try {
    return await proxyApiRequest('DELETE', `/proxies/${proxyId}`);
  } catch (error) {
    console.error('Erreur deleteProxy:', error.message);
    throw error;
  }
}

/**
 * Récupère les infos d'un proxy spécifique
 * @param {number} proxyId - ID du proxy
 * @returns {Promise<object>}
 */
async function getProxyInfo(proxyId) {
  try {
    return await proxyApiRequest('GET', `/proxies/${proxyId}`);
  } catch (error) {
    console.error('Erreur getProxyInfo:', error.message);
    throw error;
  }
}

/**
 * Liste tous les proxies de l'utilisateur
 * @param {number} offset - Décalage pour pagination
 * @returns {Promise<Array>}
 */
async function listMyProxies(offset = 0) {
  try {
    const data = await proxyApiRequest('GET', '/proxies', null, { offset });
    
    if (Array.isArray(data)) return data;
    if (data?.list) return data.list;
    if (data?.data) return data.data;
    
    return [];
  } catch (error) {
    console.error('Erreur listMyProxies:', error.message);
    return [];
  }
}

/**
 * Vérifie la disponibilité d'un username
 * @param {string} username - Username à vérifier
 * @returns {Promise<boolean>}
 */
async function checkUsername(username) {
  try {
    const response = await proxyApiRequest('GET', '/check-username', null, { username });
    return response.available === true;
  } catch (error) {
    console.error('Erreur checkUsername:', error.message);
    return false;
  }
}

/**
 * Récupère les statistiques du service
 * @returns {Promise<object>}
 */
async function getServiceStats() {
  try {
    return await proxyApiRequest('GET', '/service-stats');
  } catch (error) {
    console.error('Erreur getServiceStats:', error.message);
    return { countries: 0, cities: 0, proxies: 0, service_providers: 0 };
  }
}

/**
 * Change le pays d'un proxy (golden seulement)
 * @param {number} proxyId - ID du proxy
 * @param {number} countryId - Nouvel ID pays
 * @returns {Promise<object>}
 */
async function changeProxyCountry(proxyId, countryId) {
  try {
    return await proxyApiRequest('POST', `/proxies/${proxyId}/change-country`, {
      country_id: countryId
    });
  } catch (error) {
    console.error('Erreur changeProxyCountry:', error.message);
    throw error;
  }
}

/**
 * Change le IP d'un proxy
 * @param {number} proxyId - ID du proxy
 * @returns {Promise<object>}
 */
async function changeProxyIP(proxyId) {
  try {
    return await proxyApiRequest('POST', `/proxies/${proxyId}/change-ip`);
  } catch (error) {
    console.error('Erreur changeProxyIP:', error.message);
    throw error;
  }
}

/**
 * Réinitialise les credentials d'un proxy
 * @param {number} proxyId - ID du proxy
 * @returns {Promise<object>}
 */
async function resetProxyCredentials(proxyId) {
  try {
    return await proxyApiRequest('POST', `/proxies/${proxyId}/reset-credentials`);
  } catch (error) {
    console.error('Erreur resetProxyCredentials:', error.message);
    throw error;
  }
}

/**
 * Récupère les logs/historique d'un proxy
 * @param {number} proxyId - ID du proxy
 * @returns {Promise<Array>}
 */
async function getProxyLogs(proxyId) {
  try {
    const data = await proxyApiRequest('GET', `/proxies/${proxyId}/logs`);
    return Array.isArray(data) ? data : data?.logs || [];
  } catch (error) {
    console.error('Erreur getProxyLogs:', error.message);
    return [];
  }
}

/**
 * Récupère la vitesse/santé d'un proxy
 * @param {number} proxyId - ID du proxy
 * @returns {Promise<object>}
 */
async function getProxyHealth(proxyId) {
  try {
    return await proxyApiRequest('GET', `/proxies/${proxyId}/health`);
  } catch (error) {
    console.error('Erreur getProxyHealth:', error.message);
    return { status: 'unknown', speed: 0 };
  }
}

/**
 * Export toutes les fonctions
 */
module.exports = {
  proxyApiRequest,
  getCountries,
  getCities,
  getServiceProviders,
  getParentProxies,
  createProxy,
  renewProxy,
  deleteProxy,
  getProxyInfo,
  listMyProxies,
  checkUsername,
  getServiceStats,
  changeProxyCountry,
  changeProxyIP,
  resetProxyCredentials,
  getProxyLogs,
  getProxyHealth,
  apiClient
};
