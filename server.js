import express from 'express';
import fetch from 'node-fetch';
import bodyParser from 'body-parser';

const app = express();
const PORT = process.env.PORT || 10000;

// Pixel e token do Facebook
const PIXEL_ID = '568969266119506';
const ACCESS_TOKEN = 'EAADU2T8mQZAUBPZAwHhvxdaNRtB2WDIqNlctT9jKk0akPQB013Bv3ZBOBsWCsvlKKKAHEOXLTW9XTLMd6vTV0t1O1MQq7yHNfkc6WL0wXSIDjT1Nl8ZBh2s31eu5gGxUfN4SRAKpstFV2XZBf1dNRvdsscZCp7fAT4C9kjo4fxThuZBoEvMjZAUytZBlJlTRBrQUSoAZDZD';

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));

// Mapeamento de etapas para eventos FB e lead_status
const etapaParaEvento = {
    "Atendeu": { fbEvent: "Lead", lead_status: "Em análise" },
    "Oportunidade": { fbEvent: "ViewContent", lead_status: "Qualificado" },
    "Avançado": { fbEvent: "AddToCart", lead_status: "Qualificado" },
    "Vídeo": { fbEvent: "InitiateCheckout", lead_status: "Convertido" },
    "Vencemos": { fbEvent: "Purchase", lead_status: "Convertido", valor_purchase: 10000, moeda: "BRL" }
};

// Função para enviar evento para Facebook Conversions API
async function enviarEventoParaFacebook(lead) {
    const url = `https://graph.facebook.com/v23.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

    const userData = {
        em: lead.email ? hashSHA256(lead.email) : undefined,
        ph: lead.phone ? hashSHA256(lead.phone) : undefined
    };

    const eventData = {
        event_name: lead.fb_event,
        event_time: Math.floor(Date.now() / 1000),
        user_data: userData,
        custom_data: {}
    };

    if (lead.fb_event === 'Purchase') {
        eventData.custom_data.value = lead.valor_purchase || 10000;
        eventData.custom_data.currency = lead.moeda || "BRL";
    }

    // Inclui lead_status como parâmetro customizado
    if (lead.lead_status) {
        eventData.custom_data.lead_status = lead.lead_status;
    }

    const payload = { data: [eventData] };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return await response.json();
    } catch (err) {
        console.error("Erro ao enviar para Facebook:", err);
        return { error: err.message };
    }
}

// Função para hashear dados PII (SHA256)
import crypto from 'crypto';
function hashSHA256(value) {
    return crypto.createHash('sha256').update(value.toLowerCase().trim()).digest('hex');
}

// Rota webhook
app.post('/webhook', async (req, res) => {
    try {
        const leadWrapper = req.body;
        const lead = leadWrapper.lead || {};
        const tagName = leadWrapper.tag?.name;

        if (!tagName) {
            console.warn("Tag não encontrada no webhook");
        }

        const etapaKey = Object.keys(etapaParaEvento).find(k => k.toLowerCase() === (tagName || '').toLowerCase());

        if (etapaKey) {
            const mapping = etapaParaEvento[etapaKey];
            lead.fb_event = mapping.fbEvent;
            lead.lead_status = mapping.lead_status;

            if (lead.fb_event === 'Purchase') {
                lead.valor_purchase = mapping.valor_purchase;
                lead.moeda = mapping.moeda;
            }
        } else {
            lead.fb_event = "Lead";
            lead.lead_status = "Desconhecido";
        }

        console.log("📥 Recebido webhook:", lead);

        const fbResponse = await enviarEventoParaFacebook(lead);

        console.log("📤 Resposta do Conversions API:", fbResponse);

        res.json({ success: true, fbEvent: lead.fb_event, fbResponse });
    } catch (err) {
        console.error("Erro no webhook:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
