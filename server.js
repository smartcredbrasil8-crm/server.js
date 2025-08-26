// server.js
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;

// Substitua pelos seus dados do Pixel
const PIXEL_ID = "568969266119506";
const PIXEL_TOKEN = "EAADU2T8mQZAUBPRbatdIN038ucTUcp7O8tENhNCZBvX5LCGBzpcawiN7ZAiTG75X9o5cbJP8Kc2BZAoo3FEJGtZAzCEuXNxPpWEoYxGnbfuBleZAnfthkWmMENBRsB5u2rD2DBB7Q36t2tSRhec8tZA2IKt5h2EzSonvy6oClmbVH6lGaVRsB7xcdUkpsZCLv8ZCw3AZDZD";

// Middleware
app.use(bodyParser.json());

// Mapa de etapas do CRM para eventos do Facebook
const eventMap = {
  "atendeu": "Lead",
  "Oportunidade": "ViewContent",
  "Avançado": "AddToCart",
  "Vídeo": "InitiateCheckout",
  "Vencemos": "Purchase"
};

// Função para converter dados PII em hash SHA256
function hashSHA256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// Endpoint para receber webhooks do CRM
app.post("/webhook", async (req, res) => {
  const leadData = req.body;

  // Extrair etapa e remover números ou prefixos
  const etapa = leadData.etapa.replace(/^(\d+_)?/, "");
  const facebookEvent = eventMap[etapa];

  console.log("Recebido webhook:", leadData);
  console.log("Evento mapeado para Facebook Pixel:", facebookEvent);

  if (!facebookEvent) {
    console.error("Etapa não mapeada para evento do Facebook:", etapa);
    return res.status(400).send("Etapa não mapeada");
  }

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v23.0/${PIXEL_ID}/events?access_token=${PIXEL_TOKEN}`,
      {
        data: [{
          event_name: facebookEvent,
          event_time: Math.floor(Date.now() / 1000),
          user_data: {
            em: hashSHA256(leadData.email || ""),
            ph: hashSHA256(leadData.telefone || "")
          },
          custom_data: {
            leadId: leadData.leadId || "",
            nome: leadData.nome || ""
          }
        }]
      }
    );

    console.log("Resposta do Conversions API:", response.data);
    res.status(200).send("OK");
  } catch (error) {
    console.error(
      "Erro ao processar webhook:",
      error.response ? error.response.data : error.message
    );
    res.status(500).send("Erro ao processar webhook");
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Seu serviço está ativo 🎉`);
  console.log(`Disponível em seu URL principal http://localhost:${PORT}`);
});
