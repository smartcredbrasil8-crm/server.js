import express from 'express';
import fetch from 'node-fetch';
import crypto from 'crypto';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// Meta CAPI
const PIXEL_ID = "568969266119506";
const ACCESS_TOKEN = "EAADU2T8mQZAUBPcsqtNZBWz4ae0GmoZAqRpmC3U2zdAlmpNTQR3yn9fFMr1vhuzZAQMlhE0vJ7eZBXfZAnFEVlxo57vhxEm9axplSs4zwUpV4EuOXcpYnefhuD0Wy44p9sZCFyxGLd61NM2sZBQGAZBRJXETR29Q3pqxGPZBLccMZAKFEhEZBZAbYMZB95QVcEqt5O7H33jQZDZD";

// Função para hash em SHA256
const hashSHA256 = (value) => {
    if (!value) return "";
    return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
};

// Mapear tags do Greenn Sales para nomes de evento Meta
const mapTagToEventName = (tagName) => {
    const tag = tagName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if(tag === "oportunidade") return "Em análise";
    if(tag === "video") return "Qualificado";
    if(tag === "vencemos") return "Convertido";
    return "Evento personalizado";
};

// Endpoint webhook
app.post('/webhook', async (req, res) => {
    const { lead, tag, seller } = req.body;
    const eventName = mapTagToEventName(tag?.name || "");

    // Payload Meta CAPI com hash de dados do cliente
    const payload = {
        data: [
            {
                event_name: eventName,
                event_time: Math.floor(Date.now() / 1000),
                action_source: "system_generated",
                event_source: "crm",
                lead_event_source: "Greenn Sales",
                user_data: {
                    em: hashSHA256(lead?.email),
                    ph: hashSHA256(lead?.phone),
                    fn: hashSHA256(lead?.name),
                    ln: hashSHA256(lead?.name.split(" ").slice(-1).join(" ")),
                    ct: hashSHA256(lead?.city || lead?.cidade),
                    st: hashSHA256(lead?.state || lead?.estado),
                    zp: hashSHA256(lead?.zip || lead?.cep),
                    external_id: lead?.id.toString(),
                }
            }
        ]
    };

    try {
        const response = await fetch(`https://graph.facebook.com/v23.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        console.log(`📤 Evento enviado (${eventName}):`, data);
        res.status(200).json({ success: true, fbResult: data });
    } catch (error) {
        console.error("❌ Erro ao enviar evento:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/', (req, res) => {
    res.send("Webhook do Greenn Sales rodando!");
});

app.listen(PORT, () => {
    console.log(`✅ Webhook rodando na porta ${PORT}`);
});
