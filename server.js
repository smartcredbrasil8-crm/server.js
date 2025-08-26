import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import crypto from "crypto";

// Configurações do Pixel
const PIXEL_ID = "568969266119506";
const ACCESS_TOKEN = "EAADU2T8mQZAUBPZAwHhvxdaNRtB2WDIqNlctT9jKk0akPQB013Bv3ZBOBsWCsvlKKKAHEOXLTW9XTLMd6vTV0t1O1MQq7yHNfkc6WL0wXSIDjT1Nl8ZBh2s31eu5gGxUfN4SRAKpstFV2XZBf1dNRvdsscZCp7fAT4C9kjo4fxThuZBoEvMjZAUytZBlJlTRBrQUSoAZDZD";

// Inicializa o Express
const app = express();
const PORT = process.env.PORT || 10000;

app.use(bodyParser.json());

// Função para gerar SHA256
function hashSHA256(value) {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

// Mapeamento de etapas para eventos do Facebook
const etapaToEvent = {
  "ATENDEU": "Lead",
  "OPORTUNIDADE": "ViewContent",
  "AVANCADO": "AddToCart",
  "VIDEO": "InitiateCheckout",
  "VENCEMOS": "Purchase"
};

// Webhook para receber leads do CRM
app.post("/webhook", async (req, res) => {
  try {
    const leadData = req.body.lead;
    const tagData = req.body.tag;

    if (!leadData || !tagData) {
      return res.status(400).send({ error: "lead ou tag ausentes" });
    }

    // Normaliza o nome da etapa: remove acentos, maiúsculas, espaços extras
    const etapa = tagData.name
      .normalize("NFD") // separa acentos
      .replace(/[\u0300-\u036f]/g, "") // remove acentos
      .trim()
      .toUpperCase();

    const eventoFacebook = etapaToEvent[etapa];

    if (!eventoFacebook) {
      return res.status(400).send({ error: "Etapa do lead não mapeada para evento Facebook" });
    }

    // Cria user_data com hash SHA256
    const user_data = {
      em: hashSHA256(leadData.email || ""),
      ph: hashSHA256(leadData.phone || ""),
      fn: hashSHA256(leadData.name || "")
    };

    // Cria custom_data
    const custom_data = {
      lead_status: tagData.name
    };

    // Para evento de Purchase, adiciona value e currency
    if (eventoFacebook === "Purchase") {
      custom_data.value = 10000; // Valor de R$ 10.000,00
      custom_data.currency = "BRL";
    }

    // Objeto do evento
    const eventObj = {
      data: [
        {
          event_name: eventoFacebook,
          event_time: Math.floor(Date.now() / 1000),
          user_data: user_data,
          custom_data: custom_data,
          event_source_url: "CRM",
        }
      ]
    };

    // Envia para a Conversions API
    const response = await fetch(`https://graph.facebook.com/v23.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventObj)
    });

    const fbResponse = await response.json();

    console.log("📥 Recebido webhook:", req.body);
    console.log("📤 Resposta do Conversions API:", fbResponse);

    res.status(200).send({ success: true, fbEvent: eventoFacebook, fbResponse });
  } catch (err) {
    console.error("Erro ao processar webhook:", err);
    res.status(500).send({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
