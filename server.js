import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

// Substitua pelos seus dados do Facebook
const PIXEL_ID = "568969266119506";
const ACCESS_TOKEN = "EAADU2T8mQZAUBPZAwHhvxdaNRtB2WDIqNlctT9jKk0akPQB013Bv3ZBOBsWCsvlKKKAHEOXLTW9XTLMd6vTV0t1O1MQq7yHNfkc6WL0wXSIDjT1Nl8ZBh2s31eu5gGxUfN4SRAKpstFV2XZBf1dNRvdsscZCp7fAT4C9kjo4fxThuZBoEvMjZAUytZBlJlTRBrQUSoAZDZD";

// Configura o body parser
app.use(bodyParser.json());

// Mapeamento do CRM para lead_status
const etapaParaLeadStatus = {
  "oportunidade": "Em análise",
  "vídeo": "Qualificado",
  "vencemos": "Convertido",
};

app.post("/webhook", async (req, res) => {
  try {
    const leadData = req.body.lead || req.body; // aceita lead dentro de objeto ou direto
    const etapaCRM = req.body.tag?.name || leadData.etapa || "";
    
    // Normaliza para minúsculas e sem acento
    const etapaNormalizada = etapaCRM.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    let lead_status = etapaParaLeadStatus[etapaNormalizada] || "Desconhecido";

    // Monta o objeto para enviar ao Facebook
    const fbEvent = {
      event_name: "LeadStatusUpdate",
      event_time: Math.floor(Date.now() / 1000),
      user_data: {
        em: leadData.email ? [leadData.email.toLowerCase()] : undefined,
        ph: leadData.phone ? [leadData.phone.replace(/\D/g, "")] : undefined,
        fn: leadData.name ? [leadData.name.toLowerCase()] : undefined,
      },
      custom_data: {
        lead_status: lead_status,
      },
    };

    // Adiciona valor de Purchase se lead_status for Convertido e etapa for "Vencemos"
    if (lead_status === "Convertido") {
      fbEvent.custom_data.value = 10000; // R$ 10.000
      fbEvent.custom_data.currency = "BRL";
    }

    // Envia para Conversions API
    const response = await fetch(`https://graph.facebook.com/v23.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [fbEvent] }),
    });

    const fbResponse = await response.json();

    console.log("📥 Recebido webhook:", leadData);
    console.log("📤 Resposta do Conversions API:", fbResponse);

    res.json({ success: true, fbEvent: lead_status, fbResponse });
  } catch (err) {
    console.error("Erro ao processar webhook:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
