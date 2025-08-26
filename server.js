// server.js
import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 10000;

// Substitua pelo seu Access Token e Pixel ID
const ACCESS_TOKEN = "EAADU2T8mQZAUBPZAwHhvxdaNRtB2WDIqNlctT9jKk0akPQB013Bv3ZBOBsWCsvlKKKAHEOXLTW9XTLMd6vTV0t1O1MQq7yHNfkc6WL0wXSIDjT1Nl8ZBh2s31eu5gGxUfN4SRAKpstFV2XZBf1dNRvdsscZCp7fAT4C9kjo4fxThuZBoEvMjZAUytZBlJlTRBrQUSoAZDZD";
const PIXEL_ID = "568969266119506";

app.use(express.json());

// Função para gerar hash SHA256
function hashSHA256(value) {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

// Mapeamento de etapas do CRM para lead_status
const etapaParaLeadStatus = {
  "oportunidade": "Em analise",
  "vídeo": "Qualificado",
  "vencemos": "Convertido"
};

app.post("/webhook", async (req, res) => {
  try {
    const { lead, tag } = req.body;

    // Normaliza e ignora maiúsculas/minúsculas e acentos
    const etapaNormalizada = tag.name.toLowerCase().normalize("NFD").replace(/[^\u0000-\u007F]/g, "");

    let lead_status = "Desconhecido";
    for (let key in etapaParaLeadStatus) {
      const keyNormalizada = key.toLowerCase().normalize("NFD").replace(/[^\u0000-\u007F]/g, "");
      if (etapaNormalizada === keyNormalizada) {
        lead_status = etapaParaLeadStatus[key];
        break;
      }
    }

    // Hash SHA256 dos dados PII
    const user_data = {
      em: lead.email ? hashSHA256(lead.email) : undefined,
      ph: lead.phone ? hashSHA256(lead.phone) : undefined,
      fn: lead.name ? hashSHA256(lead.name) : undefined
    };

    // Monta payload para Conversions API
    const payload = {
      data: [
        {
          event_name: "Lead",
          event_time: Math.floor(Date.now() / 1000),
          user_data,
          custom_data: {
            lead_status
          },
          action_source: "website"
        }
      ]
    };

    // Envia para Facebook Conversions API
    const response = await fetch(`https://graph.facebook.com/v23.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    console.log("📤 Resposta do Conversions API:", result);

    res.status(200).json({ success: true, fbResponse: result });
  } catch (err) {
    console.error("❌ Erro ao processar webhook:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
