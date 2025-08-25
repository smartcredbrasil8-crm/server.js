const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(bodyParser.json());

const PIXEL_ID = process.env.PIXEL_ID;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

function hashData(data) {
  return crypto.createHash("sha256").update(data.trim().toLowerCase()).digest("hex");
}

// Mapeamento de status do CRM para eventos do Facebook
function getFacebookEvent(status) {
  switch (status) {
    case "Novo": return "Lead";
    case "Atendeu": return "Contact";
    case "Oportunidade": return "InitiateCheckout";
    case "Avançado": return "AddToCart";
    case "Vídeo": return "CompleteRegistration";
    case "Vencemos": return "Purchase";
    default: return "Lead";
  }
}

app.post("/webhook", async (req, res) => {
  try {
    const lead = req.body;
    const eventName = getFacebookEvent(lead.status);

    const userData = {};
    if (lead.email) userData.email = hashData(lead.email);
    if (lead.phone) userData.phone = hashData(lead.phone);

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          user_data: userData,
          custom_data: {
            lead_status: lead.status,
            lead_value: lead.value || 0
          },
          event_source_url: "https://suaempresa.com.br"
        }
      ]
    };

    await axios.post(
      `https://graph.facebook.com/v17.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
      payload
    );

    res.status(200).send(`✅ Evento "${eventName}" enviado com sucesso!`);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("❌ Erro ao enviar evento");
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
