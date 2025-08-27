// server.js
import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();
app.use(bodyParser.json());

// ⚙️ Configurações
const PORT = process.env.PORT || 3000;
const FB_ACCESS_TOKEN = "EAADU2T8mQZAUBPcsqtNZBWz4ae0GmoZAqRpmC3U2zdAlmpNTQR3yn9fFMr1vhuzZAQMlhE0vJ7eZBXfZAnFEVlxo57vhxEm9axplSs4zwUpV4EuOXcpYnefhuD0Wy44p9sZCFyxGLd61NM2sZBQGAZBRJXETR29Q3pqxGPZBLccMZAKFEhEZBZAbYMZB95QVcEqt5O7H33jQZDZD";
const PIXEL_ID = "568969266119506";
const FB_API_VERSION = "v23.0";
const FB_API_URL = `https://graph.facebook.com/${FB_API_VERSION}/${PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`;

// 🔒 Hash SHA256 exigido pela Meta
function hashSHA256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// 🔤 Normaliza string (minúsculo + remove acento)
function normalizeString(str) {
  return str
    ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    : "";
}

// 🎯 Mapeamento de tags → eventos personalizados
function mapTagToEventName(tagName) {
  const normalized = normalizeString(tagName);

  if (normalized === "oportunidade") return "Em análise";
  if (normalized === "video") return "Qualificado";
  if (normalized === "vencemos") return "Convertido";

  return "Evento personalizado"; // fallback se não bater
}

// 🟢 Webhook do Greenn Sales
app.post("/webhook", async (req, res) => {
  try {
    const { lead, tag } = req.body;

    console.log("📥 Webhook recebido:", JSON.stringify(req.body, null, 2));

    // ⏱ Tempo do evento
    const event_time = Math.floor(Date.now() / 1000);

    // Normalização de dados do usuário
    const email = lead?.email ? lead.email.trim().toLowerCase() : null;
    const phone = lead?.phone ? lead.phone.replace(/\D/g, "") : null;

    // 🎯 Define o evento Meta com base na TAG
    const event_name = mapTagToEventName(tag?.name);

    // 📦 Payload da Meta
    const payload = {
      data: [
        {
          event_name, // agora envia "Em análise", "Qualificado", "Convertido"
          event_time,
          action_source: "system_generated",
          custom_data: {
            crm: "Greenn Sales",
            tag: tag?.name || "desconhecida",
            lead_status: lead?.status || "n/a"
          },
          user_data: {
            em: email ? [hashSHA256(email)] : [],
            ph: phone ? [hashSHA256(phone)] : [],
            fn: lead?.name ? [hashSHA256(lead.name.split(" ")[0])] : [],
            ln: lead?.name ? [hashSHA256(lead.name.split(" ").slice(1).join(" "))] : [],
            external_id: lead?.id ? [String(lead.id)] : []
          }
        }
      ]
    };

    // ▶️ Envio para Meta
    const fbResponse = await fetch(FB_API_URL, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" }
    });

    const fbResult = await fbResponse.json();
    console.log(`📤 Evento enviado (${event_name}):`, fbResult);

    res.status(200).send({ success: true, fbResult });
  } catch (error) {
    console.error("❌ Erro no webhook:", error);
    res.status(500).send({ success: false, error: error.message });
  }
});

// 🚀 Iniciar servidor
app.listen(PORT, () => {
  console.log(`✅ Webhook rodando na porta ${PORT}`);
});
