const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const crypto = require("crypto");

const app = express();
app.use(bodyParser.json());

// 🔑 Token e Pixel ID do Facebook
const FB_ACCESS_TOKEN = "EAADU2T8mQZAUBPZAwHhvxdaNRtB2WDIqNlctT9jKk0akPQB013Bv3ZBOBsWCsvlKKKAHEOXLTW9XTLMd6vTV0t1O1MQq7yHNfkc6WL0wXSIDjT1Nl8ZBh2s31eu5gGxUfN4SRAKpstFV2XZBf1dNRvdsscZCp7fAT4C9kjo4fxThuZBoEvMjZAUytZBlJlTRBrQUSoAZDZD";
const PIXEL_ID = "568969266119506";

// Função para remover acentos e normalizar etapa
const normalizar = (texto) =>
  texto
    ? texto
        .normalize("NFD") // separa acentos
        .replace(/[\u0300-\u036f]/g, "") // remove acentos
        .toLowerCase() // caixa baixa
    : "";

// Função para gerar hash SHA256
const hashSHA256 = (value) => {
  if (!value) return null;
  return crypto
    .createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
};

// Mapeamento de etapas para eventos do Facebook
const etapaParaEvento = {
  atendeu: "Lead",
  oportunidade: "ViewContent",
  avancado: "AddToCart",
  video: "InitiateCheckout",
  vencemos: "Purchase"
};

// Endpoint para receber o webhook
app.post("/webhook", async (req, res) => {
  try {
    const leadData = req.body;

    console.log("📥 Recebido webhook:", leadData);

    // Normaliza etapa recebida
    const etapaNormalizada = normalizar(leadData.etapa);

    // Seleciona o evento correspondente ou usa Lead como fallback
    const fbEvent = etapaParaEvento[etapaNormalizada] || "Lead";

    // Monta payload para o Facebook Conversions API com hash dos dados
    const payload = {
      data: [
        {
          event_name: fbEvent,
          event_time: Math.floor(Date.now() / 1000),
          user_data: {
            em: [hashSHA256(leadData.email)],
            ph: [hashSHA256(leadData.telefone)],
            fn: [hashSHA256(leadData.nome)]
          },
          custom_data: {
            leadId: leadData.leadId
          }
        }
      ]
    };

    // Envia para Facebook CAPI
    const response = await fetch(
      `https://graph.facebook.com/v13.0/${PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    const result = await response.json();
    console.log("📤 Resposta do Conversions API:", result);

    res.status(200).json({ success: true, fbEvent, result });
  } catch (error) {
    console.error("❌ Erro ao processar webhook:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
