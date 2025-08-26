const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;

// Configurações do Pixel
const PIXEL_ID = "568969266119506";
const ACCESS_TOKEN = "EAADU2T8mQZAUBPRbatdIN038ucTUcp7O8tENhNCZBvX5LCGBzpcawiN7ZAiTG75X9o5cbJP8Kc2BZAoo3FEJGtZAzCEuXNxPpWEoYxGnbfuBleZAnfthkWmMENBRsB5u2rD2DBB7Q36t2tSRhec8tZA2IKt5h2EzSonvy6oClmbVH6lGaVRsB7xcdUkpsZCLv8ZCw3AZDZD";

// Middleware
app.use(bodyParser.json());

// Hash SHA256
function sha256Hash(value) {
  if (!value) return null;
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

// Mapeamento CRM -> Eventos Facebook
const eventosFB = {
  "atendeu": { name: "Lead", customData: {} },
  "Oportunidade": { name: "ViewContent", customData: {} },
  "Avançado": { name: "AddToCart", customData: {} },
  "Vídeo": { name: "InitiateCheckout", customData: {} },
  "Vencemos": { name: "Purchase", customData: { value: 1000, currency: "BRL" } } // ajuste value conforme necessário
};

app.post("/webhook", async (req, res) => {
  try {
    console.log("Recebido webhook:", req.body);

    const { leadId, etapa, nome, email, telefone } = req.body;

    const userData = {
      em: sha256Hash(email),
      ph: sha256Hash(telefone),
      fn: sha256Hash(nome)
    };

    const evento = eventosFB[etapa] || { name: "Lead", customData: {} };

    const eventData = {
      event_name: evento.name,
      event_time: Math.floor(Date.now() / 1000),
      user_data: userData,
      custom_data: { ...evento.customData, lead_id: leadId }
    };

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
