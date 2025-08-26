const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;

// Configurações do Pixel
const PIXEL_ID = "568969266119506"; // ID do Pixel
const ACCESS_TOKEN = "EAADU2T8mQZAUBPRbatdIN038ucTUcp7O8tENhNCZBvX5LCGBzpcawiN7ZAiTG75X9o5cbJP8Kc2BZAoo3FEJGtZAzCEuXNxPpWEoYxGnbfuBleZAnfthkWmMENBRsB5u2rD2DBB7Q36t2tSRhec8tZA2IKt5h2EzSonvy6oClmbVH6lGaVRsB7xcdUkpsZCLv8ZCw3AZDZD";

// Middleware para processar JSON
app.use(bodyParser.json());

// Função para converter PII em SHA256
function sha256Hash(value) {
  if (!value) return null;
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

// Mapeamento de etapas para eventos amigáveis
const eventos = {
  "1_atendeu": "Lead Atendido",
  "2_oportunidade": "Oportunidade",
  "3_avancado": "Avançado",
  "4_video": "Assistiu Video",
  "5_vencemos": "Fechamento"
};

// Endpoint para receber webhooks do CRM
app.post("/webhook", async (req, res) => {
  try {
    console.log("Recebido webhook:", req.body);

    const { leadId, etapa, nome, email, telefone } = req.body;

    // Converte PII
    const userData = {
      em: sha256Hash(email),
      ph: sha256Hash(telefone),
      fn: sha256Hash(nome)
    };

    // Evento para enviar ao Pixel
    const eventData = {
      event_name: eventos[etapa] || "Lead Atualizado",
      event_time: Math.floor(Date.now() / 1000),
      user_data: userData,
      custom_data: { lead_id: leadId }
    };

    // Envia para Facebook Conversions API
    const url = `https://graph.facebook.com/v23.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
    const response = await axios.post(url, { data: [eventData] });

    console.log("Resposta do Conversions API:", response.data);
    res.status(200).send("Evento enviado com sucesso!");
  } catch (error) {
    console.error("Erro ao processar webhook:", error.response ? error.response.data : error.message);
    res.status(500).send("Erro interno do servidor");
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
