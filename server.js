import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();
app.use(bodyParser.json());

const ACCESS_TOKEN = "EAADU2T8mQZAUBPZAwHhvxdaNRtB2WDIqNlctT9jKk0akPQB013Bv3ZBOBsWCsvlKKKAHEOXLTW9XTLMd6vTV0t1O1MQq7yHNfkc6WL0wXSIDjT1Nl8ZBh2s31eu5gGxUfN4SRAKpstFV2XZBf1dNRvdsscZCp7fAT4C9kjo4fxThuZBoEvMjZAUytZBlJlTRBrQUSoAZDZD"; // substitua pelo token real
const PIXEL_ID = "568969266119506"; // substitua pelo Pixel real

// Função para enviar payload para Facebook Conversions API
async function enviarParaFacebook(payload) {
  const url = `https://graph.facebook.com/v23.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  console.log("📤 Resposta do Conversions API:", data);
  return data;
}

// Mapeamento de etapas do CRM para lead_status
const etapaParaLeadStatus = {
  "Oportunidade": "Em analise",
  "Vídeo": "Qualificado",
  "Vencemos": "Convertido"
};

// Endpoint para receber webhook do CRM
app.post("/webhook", async (req, res) => {
  try {
    const leadData = req.body.lead || {};
    const tagName = req.body.tag?.name || "Desconhecido";

    // Normaliza texto (remove acentos, ignora maiúsculas/minúsculas)
    const etapaNormalizada = tagName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

    // Busca lead_status mapeado
    let lead_status = "Desconhecido";
    for (const key in etapaParaLeadStatus) {
      const keyNormalizada = key.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      if (etapaNormalizada === keyNormalizada) {
        lead_status = etapaParaLeadStatus[key];
        break;
      }
    }

    // Monta payload para Conversions API (hash de PII)
    const payload = {
      data: [
        {
          event_name: "Lead",
          event_time: Math.floor(Date.now() / 1000),
          user_data: {
            em: leadData.email ? crypto.createHash("sha256").update(leadData.email.trim().toLowerCase()).digest("hex") : undefined,
            ph: leadData.phone ? crypto.createHash("sha256").update(leadData.phone.trim()).digest("hex") : undefined,
            fn: leadData.name ? crypto.createHash("sha256").update(leadData.name.trim().toLowerCase()).digest("hex") : undefined
          },
          custom_data: {
            lead_status: lead_status
          },
          action_source: "website"
        }
      ]
    };

    // Envia para o Facebook
    await enviarParaFacebook(payload);

    res.json({ success: true, lead_status });
  } catch (error) {
    console.error("❌ Erro ao processar webhook:", error);
    res.status(500).json({ error: error.message });
  }
});

// Porta de escuta (Render precisa da variável de ambiente PORT)
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
