// server.js
import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 10000;

// Substitua pelo seu Pixel ID e Token
const PIXEL_ID = "568969266119506";
const ACCESS_TOKEN = "EAADU2T8mQZAUBPZAwHhvxdaNRtB2WDIqNlctT9jKk0akPQB013Bv3ZBOBsWCsvlKKKAHEOXLTW9XTLMd6vTV0t1O1MQq7yHNfkc6WL0wXSIDjT1Nl8ZBh2s31eu5gGxUfN4SRAKpstFV2XZBf1dNRvdsscZCp7fAT4C9kjo4fxThuZBoEvMjZAUytZBlJlTRBrQUSoAZDZD";

// Mapear etapas do CRM para eventos do Facebook Pixel
const etapaParaEvento = {
  "Atendeu": "Lead",
  "Oportunidade": "ViewContent",
  "Avancado": "AddToCart",
  "Video": "InitiateCheckout",
  "Vencemos": "Purchase"
};

// Middleware
app.use(bodyParser.json());

// Endpoint do webhook
app.post("/webhook", async (req, res) => {
  const leadData = req.body;

  if (!leadData || !leadData.etapa) {
    return res.status(400).json({ error: "Webhook inválido ou etapa não definida" });
  }

  // Normaliza etapa, remove acentos e espaços
  const etapa = leadData.etapa.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const fbEvent = etapaParaEvento[etapa];

  if (!fbEvent) {
    return res.status(400).json({ error: `Etapa desconhecida: ${etapa}` });
  }

  // Monta payload para Facebook Conversions API
  const payload = {
    data: [
      {
        event_name: fbEvent,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "website",
        event_source_url: leadData.url || "https://example.com",
        user_data: {
          em: leadData.email ? [sha256(leadData.email)] : [],
          ph: leadData.telefone ? [sha256(leadData.telefone)] : []
        },
        custom_data: fbEvent === "Purchase" ? { currency: "BRL", value: 1 } : {}
      }
    ]
  };

  try {
    const response = await fetch(`https://graph.facebook.com/v23.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    console.log("📤 Resposta do Conversions API:", result);

    res.json({ success: true, fbEvent: fbEvent, result });
  } catch (error) {
    console.error("Erro ao processar webhook:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Função para hash SHA256
function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// Inicia servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
