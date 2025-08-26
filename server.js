// server.js
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

// Configurar para receber JSON
app.use(express.json());

// Seu Pixel ID e Token do Pixel
const PIXEL_ID = "568969266119506";
const ACCESS_TOKEN = "EAADU2T8mQZAUBPRbatdIN038ucTUcp7O8tENhNCZBvX5LCGBzpcawiN7ZAiTG75X9o5cbJP8Kc2BZAoo3FEJGtZAzCEuXNxPpWEoYxGnbfuBleZAnfthkWmMENBRsB5u2rD2DBB7Q36t2tSRhec8tZA2IKt5h2EzSonvy6oClmbVH6lGaVRsB7xcdUkpsZCLv8ZCw3AZDZD";

// Mapeamento de etapas do CRM para eventos do Pixel
const etapaParaEvento = {
  "1_atendeu": "LeadAtendeu",
  "2_oportunidade": "LeadOportunidade",
  "3_avancado": "LeadAvancado",
  "4_video": "LeadVideo",
  "5_vencemos": "LeadVencemos"
};

// Rota do webhook
app.post("/webhook", async (req, res) => {
    try {
        const { leadId, etapa, nome, email, telefone } = req.body;
        console.log("Recebido webhook:", req.body);

        if (!etapaParaEvento[etapa]) {
            console.log("Etapa desconhecida:", etapa);
            return res.status(400).send("Etapa desconhecida");
        }

        const evento = etapaParaEvento[etapa];

        // Monta payload para o Conversions API
        const payload = {
            data: [
                {
                    event_name: evento,
                    event_time: Math.floor(Date.now() / 1000),
                    action_source: "website",
                    event_source_url: "https://seu-site.com",
                    user_data: {
                        email: email ? [email] : [],
                        phone: telefone ? [telefone] : []
                    },
                    custom_data: {
                        lead_id: leadId,
                        nome: nome
                    }
                }
            ]
        };

        // Envia para o Pixel via Conversions API
        const url = `https://graph.facebook.com/v23.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

        const response = await axios.post(url, payload);
        console.log("Resposta do Conversions API:", response.data);

        res.status(200).send("Evento enviado");
    } catch (error) {
        console.error("Erro ao processar webhook:", error.response ? error.response.data : error.message);
        res.status(500).send("Erro no servidor");
    }
});

// Inicia servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
