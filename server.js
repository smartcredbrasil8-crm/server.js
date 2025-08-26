// server.js
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 10000;

// ⚠️ ID e TOKEN fixos
const PIXEL_ID = "568969266119506";
const ACCESS_TOKEN = "EAADU2T8mQZAUBPZAwHhvxdaNRtB2WDIqNlctT9jKk0akPQB013Bv3ZBOBsWCsvlKKKAHEOXLTW9XTLMd6vTV0t1O1MQq7yHNfkc6WL0wXSIDjT1Nl8ZBh2s31eu5gGxUfN4SRAKpstFV2XZBf1dNRvdsscZCp7fAT4C9kjo4fxThuZBoEvMjZAUytZBlJlTRBrQUSoAZDZD";

// Mapeamento de etapas → lead_status aceitos pela Meta
const etapaParaLeadStatus = {
  "oportunidade": "OPEN",
  "video": "QUALIFIED",
  "vencemos": "CONVERTED"
};

// Funções utilitárias
function normalizar(str) {
  if (!str && str !== "") return "";
  return String(str).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function hashEmail(value) {
  if (!value) return undefined;
  return crypto.createHash("sha256").update(String(value).trim().toLowerCase()).digest("hex");
}
function hashName(value) {
  if (!value) return undefined;
  return crypto.createHash("sha256").update(String(value).trim().toLowerCase()).digest("hex");
}
function hashPhone(value) {
  if (!value) return undefined;
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return undefined;
  return crypto.createHash("sha256").update(digits).digest("hex");
}

// Rota principal do webhook
app.post("/webhook", async (req, res) => {
  try {
    const payloadIn = req.body || {};
    const lead = payloadIn.lead || payloadIn;
    const tagName = payloadIn.tag?.name || lead.etapa || lead.status || "";

    const etapaNorm = normalizar(tagName);
    const lead_status = etapaParaLeadStatus[etapaNorm] || "UNKNOWN";

    // user_data com hash
    const user_data = {};
    const he = hashEmail(lead.email);
    const hp = hashPhone(lead.phone || lead.phone_number || lead.telefone);
    const hn = hashName(lead.name || lead.first_name || lead.nome);
    if (he) user_data.em = he;
    if (hp) user_data.ph = hp;
    if (hn) user_data.fn = hn;

    // custom_data
    const custom_data = { lead_status };
    if (lead_status === "CONVERTED") {
      const valor = (lead.valor_purchase || lead.value || lead.purchase_value) || 10000;
      custom_data.value = Number(valor);
      custom_data.currency = (lead.moeda || lead.currency || "BRL").toUpperCase();
    }

    const event = {
      event_name: "Lead",
      event_time: Math.floor(Date.now() / 1000),
      user_data,
      custom_data,
      action_source: "website"
    };

    const fbPayload = { data: [event] };

    console.log("📥 Recebido webhook:", {
      lead_id: lead.id || lead.leadId,
      tagName,
      lead_status,
      user_data_keys: Object.keys(user_data),
      custom_data
    });

    const fbUrl = `https://graph.facebook.com/v23.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
    const fbResp = await axios.post(fbUrl, fbPayload, { headers: { "Content-Type": "application/json" } });

    console.log("📤 Resposta Conversions API:", fbResp.data);

    return res.json({ success: true, lead_status, fbResponse: fbResp.data });
  } catch (err) {
    console.error("❌ Erro webhook:", err?.response?.data || err.message || err);
    return res.status(500).json({ success: false, error: (err?.response?.data || err.message || String(err)) });
  }
});

app.get("/", (req, res) => res.send("Webhook listener ok ✅"));

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
