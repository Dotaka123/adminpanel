// --- LOGIQUE ADMIN AVANCÉE ---

// 1. Route pour REFUSER une commande
app.post('/admin/reject', async (req, res) => {
    const { orderId } = req.body;
    const order = await Order.findOneAndUpdate({ orderId }, { status: 'REFUSÉ' });
    
    if (order) {
        sendText(order.psid, `❌ Votre commande ${orderId} a été refusée après vérification. Veuillez contacter le support si vous pensez qu'il s'agit d'une erreur.`);
    }
    res.redirect('/admin/panel');
});

// 2. Route pour ACCEPTER et LIVRER
app.post('/admin/deliver', async (req, res) => {
    const { orderId, proxyData } = req.body;
    
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 30); // Validité 30 jours

    const order = await Order.findOneAndUpdate(
        { orderId: orderId },
        { 
            status: 'LIVRÉ', 
            proxyData: proxyData, 
            expiresAt: expiry 
        },
        { new: true }
    );

    if (order) {
        // NOTIFICATION AUTOMATIQUE VERS MESSENGER
        const msg = `🎉 Félicitations ! Votre proxy (${order.provider}) a été activé avec succès.\n\n` +
                    `🌐 Détails : ${proxyData}\n` +
                    `📅 Expire le : ${expiry.toLocaleDateString()}\n\n` +
                    `Retrouvez-le à tout moment dans : Mon Compte -> Mes Proxys.`;
        sendText(order.psid, msg);
    }

    res.redirect('/admin/panel');
});
