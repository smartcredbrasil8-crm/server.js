const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

// Configura o body-parser para receber JSON
app.use(bodyParser.json());

// Configurações do Pixel
const PIXEL_ID = "568969266119506";
const ACCESS_TOKEN = "EAADU2T8mQZAUBPRbatdIN038ucTUcp7O8tENhNCZBvX5LCGBzpcawiN7ZAiTG75X9o5cbJP8Kc2BZAoo3FEJGtZAzCEuXNxPpWEoYxGnbfuBleZAnfthkWmMENBRsB5u2rD2DBB7Q36t2tSRhec8tZA2IKt5h2EzSonvy6oClmbVH6lGaVRsB7xcdUkpsZCLv8ZCw3AZDZD";

// Mapeamento das etapas do funil do CRM para eventos do Pixel
const funilParaEvento = {
  "1_atendeu": "LeadAtendeu",
  "2_oportunidade": "Oportunidade",
  "3_avancado": "Avancado",
  "4_video": "VisualizouVideo",
  "5_vencemos": "Vencemos"
};

// Função para hash SHA256 (requerido pelo Facebook)
function hashSHA256(data) {
  return crypto.createHash('sha256').update(data.trim().toLowerCase()).digest('hex');
}

// Função para salvar logs locais
function logEventoLocal(evento) {
  const logPath = path.join(__dirname, "events.log");
  const logLinha = `[${new Date().toISOString()}] ${JSON.stringify(evento)}\n`;
  fs.appendFile(logPath, logLinha, (err) => {
    if (err) console.error("Erro ao salvar log local:", err);
  });
}

// Endpoint que recebe webhooks do Greenn Sales
app.post("/webhook", async (req, res) => {
  console.log("Recebido webhook:", req.body);
  logEventoLocal({ tipo: "recebido", dados: req.body });

  try {
    const { leadId, etapa, nome, email, telefone } = req.body;
    const eventName = funilParaEvento[etapa];

    if (!eventName) {
      console.log("Etapa desconhecida, ignorando evento.");
      logEventoLocal({ tipo: "erro", mensagem: "Etapa inválida", etapa });
      return res.status(400).send("Etapa inválida");
    }

    // Monta o payload para o Facebook Conversions API
    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          action_source: "website",
          event_source_url: "https://seusite.com", // opcional
          user_data: {
            client_user_agent: req.headers["user-agent"] || "",
            em: email ? hashSHA256(email) : undefined,
            fn: nome ? hashSHA256(nome) : undefined,
            ph: telefone ? hashSHA256(telefone) : undefined
          },
          custom_data: {
            leadId: leadId
          }
        }
      ]
    };

    // Envia evento para o Pixel
    const fbResponse = await axios.post(
      `https://graph.facebook.com/v23.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
      payload
    );

    console.log("Resposta do Pixel:", fbResponse.data);
    logEventoLocal({ tipo: "enviado", eventName, fbResponse: fbResponse.data });

    res.status(200).send("Evento enviado ao Pixel");

  } catch (error) {
    console.error("Erro ao enviar evento:", error.response?.data || error.message);
    logEventoLocal({ tipo: "erro", mensagem: error.response?.data || error.message });
    res.status(500).send("Erro interno");
  }
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
