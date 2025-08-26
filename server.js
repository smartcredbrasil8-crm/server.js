import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 10000;

// Facebook Pixel e Access Token
const FB_PIXEL_ID = "568969266119506";
const ACCESS_TOKEN = "EAADU2T8mQZAUBPZAwHhvxdaNRtB2WDIqNlctT9jKk0akPQB013Bv3ZBOBsWCsvlKKKAHEOXLTW9XTLMd6vTV0t1O1MQq7yHNfkc6WL0wXSIDjT1Nl8ZBh2s31eu5gGxUfN4SRAKpstFV2XZBf1dNRvdsscZCp7fAT4C9kjo4fxThuZBoEvMjZAUytZBlJlTRBrQUSoAZDZD";

app.use(express.json());

// Função para gerar hash SHA256
function sha256Hash(value) {
    return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

// Mapeamento lead_status
const etapaParaLeadStatus = {
    "OPORTUNIDADE": "In Review",
    "VIDEO": "Qualified",
    "VENCEMOS": "Converted"
};

// Normaliza texto (remove acentos, ignora maiúsculas/minúsculas)
function normalizeTag(tagName) {
    return tagName.trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

app.post("/webhook", async (req, res) => {
    try {
        const { lead, tag } = req.body;

        if (!lead || !tag || !tag.name) {
            return res.status(400).json({ error: "Invalid payload: missing lead or tag" });
        }

        const tagNormalized = normalizeTag(tag.name);
        const leadStatus = etapaParaLeadStatus[tagNormalized] || "Unknown";

        // Dados do usuário (em, ph, fn) devem ir em hash SHA256
        const user_data = {
            em: sha256Hash(lead.email || ""),
            ph: sha256Hash(lead.phone || ""),
            fn: sha256Hash(lead.name || "")
        };

        // Monta payload para Conversions API
        const payload = {
            data: [
                {
                    event_name: "Lead",
                    event_time: Math.floor(Date.now() / 1000),
                    action_source: "website",
                    user_data,
                    custom_data: { lead_status: leadStatus }
                }
            ]
        };

        const response = await fetch(
            `https://graph.facebook.com/v23.0/${FB_PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            }
        );

        const fbResponse = await response.json();

        console.log("📥 Recebido webhook:", req.body);
        console.log("📤 Resposta Conversions API:", fbResponse);

        res.json({ success: true, fbResponse });
    } catch (error) {
        console.error("❌ Erro ao processar webhook:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
