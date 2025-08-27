// server.js
const express = require('express');
const fetch = require('node-fetch');
const crypto = require('crypto');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 10000;

// Configurações do Facebook/Meta
const DATASET_ID = '568969266119506';
const ACCESS_TOKEN = 'EAADU2T8mQZAUBPcsqtNZBWz4ae0GmoZAqRpmC3U2zdAlmpNTQR3yn9fFMr1vhuzZAQMlhE0vJ7eZBXfZAnFEVlxo57vhxEm9axplSs4zwUpV4EuOXcpYnefhuD0Wy44p9sZCFyxGLd61NM2sZBQGAZBRJXETR29Q3pqxGPZBLccMZAKFEhEZBZAbYMZB95QVcEqt5O7H33jQZDZD';

// Parser JSON
app.use(bodyParser.json());

// Função para gerar hash SHA256
function hashSHA256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

// Função para normalizar telefone (remover caracteres não numéricos)
function normalizePhone(phone) {
    return phone ? phone.replace(/\D/g, '') : '';
}

// Mapear tag do CRM para evento do Facebook
function mapTagToEvent(tagName) {
    if (!tagName) return 'Evento personalizado';
    const normalized = tagName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    switch(normalized) {
        case 'oportunidade': return 'Em análise';
        case 'video': return 'Qualificado';
        case 'vencemos': return 'Convertido';
        default: return 'Evento personalizado';
    }
}

// Receber webhooks
app.post('/webhook', async (req, res) => {
    try {
        const { lead, tag, seller } = req.body;
        const eventName = mapTagToEvent(tag?.name);

        // Preparar parâmetros de cliente
        const customerData = {};
        if (lead?.email) customerData.em = hashSHA256(lead.email.trim().toLowerCase());
        if (lead?.phone) customerData.ph = hashSHA256(normalizePhone(lead.phone));
        if (lead?.id) customerData.lead_id = lead.id.toString();

        if (Object.keys(customerData).length === 0) {
            console.warn('⚠️ Nenhum parâmetro de cliente válido fornecido para o evento:', eventName);
        }

        // Payload para API de Conversões
        const payload = {
            data: [
                {
                    event_name: eventName,
                    event_time: Math.floor(Date.now() / 1000),
                    action_source: 'system_generated',
                    event_source: 'crm',
                    lead_event_source: 'Greenn Sales',
                    user_data: customerData
                }
            ]
        };

        // Enviar para Meta
        const response = await fetch(`https://graph.facebook.com/v23.0/${DATASET_ID}/events?access_token=${ACCESS_TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const fbResult = await response.json();

        console.log('📥 Webhook recebido:', JSON.stringify(req.body, null, 2));
        console.log(`📤 Evento enviado (${eventName}):`, JSON.stringify(fbResult, null, 2));

        res.status(200).send({ success: true, fbResult });
    } catch (err) {
        console.error('❌ Erro ao processar webhook:', err);
        res.status(500).send({ success: false, error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
