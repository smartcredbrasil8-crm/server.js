// server.js
import express from "express";
import bodyParser from "body-parser";
import crypto from "crypto";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;

// Substitua pelo seu Pixel ID e Access Token
const PIXEL_ID = "568969266119506";
const ACCESS_TOKEN = "EAADU2T8mQZAUBPZAwHhvxdaNRtB2WDIqNlctT9jKk0akPQB013Bv3ZBOBsWCsvlKKKAHEOXLTW9XTLMd6vTV0t1O1MQq7yHNfkc6WL0wXSIDjT1Nl8ZBh2s31eu5gGxUfN4SRAKpstFV2XZBf1dNRvdsscZCp7fAT4C9kjo4fxThuZBoEvMjZAUytZBlJlTRBrQUSoAZDZD";

// Função para criar hash SHA256 em minúsculo
const hashSHA256 = (value) => {
    return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
};

// Mapeamento de etapas para eventos do Facebook
const etapaParaEvento = {
    "atendeu": "Lead",
    "oportunidade": "ViewContent",
    "avancado": "AddToCart",
    "video": "InitiateCheckout",
    "vencemos": "Purchase"
};

// Normaliza strings: remove acentos e espaços
const normalizar = (str) => {
    if (!str) return "";
    return str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
};

// Webhook endpoint
app.post("/webhook", async (req, res) => {
    const leadData = req.body;
    console.log("📥 Recebido webhook:", leadData);

    if (!leadData.etapa) {
        console.log("❌ Lead sem etapa definida, ignorando.");
        return res.status(400).send("Lead sem etapa");
    }

    const etapaNormalizada = normalizar(leadData.etapa);
    let eventoFacebook = etapaParaEvento[etapaNormalizada];

    if (!eventoFacebook) {
        console.log("❌ Etapa não mapeada:", leadData.etapa);
        return res.status(400).send("Etapa não mapeada");
    }

    // Dados do usuário com hash SHA256
    const userData = {};
    if (leadData.email) userData.em = hashSHA256(leadData.email);
    if (leadData.telefone) userData.ph = hashSHA256(leadData.telefone);

    // Payload base
    const payload = {
        data: [
            {
                event_name: eventoFacebook,
                event_time: Math.floor(Date.now() / 1000),
                user_data: userData,
                action_source: "website",
                event_source_url: leadData.website || ""
            }
        ]
    };

    // Para Purchase, adiciona valor e moeda obrigatórios
    if (eventoFacebook === "Purchase") {
        payload.data[0].custom_data = {
            currency: "BRL",
            value: leadData.valor || 0
        };
    }

    try {
        const response = await fetch(`https://graph.facebook.com/v23.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`, {
            method: "POST",
            body: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" }
        });

        const json = await response.json();
        console.log("📤 Resposta do Conversions API:", json);
        res.status(200).send({ success: true, fbEvent: eventoFacebook, result: json });
    } catch (err) {
        console.error("❌ Erro ao processar webhook:", err);
        res.status(500).send({ success: false, error: err });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
