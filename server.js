// server.js
import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// ===== Configurações da Meta =====
const PIXEL_ID = "568969266119506";
const ACCESS_TOKEN = "EAADU2T8mQZAUBPcsqtNZBWz4ae0GmoZAqRpmC3U2zdAlmpNTQR3yn9fFMr1vhuzZAQMlhE0vJ7eZBXfZAnFEVlxo57vhxEm9axplSs4zwUpV4EuOXcpYnefhuD0Wy44p9sZCFyxGLd61NM2sZBQGAZBRJXETR29Q3pqxGPZBLccMZAKFEhEZBZAbYMZB95QVcEqt5O7H33jQZDZD";

// ===== Função auxiliar para mapear tags para eventos =====
function mapTagToEvent(tagName) {
  const tag = tagName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // ignora maiúsc/minúsc e acento
  switch(tag) {
    case "oportunidade": return "Em análise";
    case "video": return "Qualificado";
    case "vencemos": return "Convertido";
    default: return "Evento personalizado";
  }
}

// ===== Função para enviar evento à Meta =====
async function sendToMeta(eventName, lead) {
  const url = `https://graph.facebook.com/v23.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  // Construção do payload mínimo
  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "system_generated",
        event_source: "crm",
        lead_event_source: "Greenn Sales",
        user_data: {
          em: lead.email ? [lead.email.toLowerCase()] : [],
          ph: lead.phone ? [lead.phone.replace(/\D/g, "")] : [],
          fn: lead.name ? [lead.name.split(" ")[0].toLowerCase()] : [],
          ln: lead.name ? [lead.name.split(" ").slice(1).join(" ").toLowerCase()] : []
        }
      }
    ]
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" }
    });
    const json = await res.json();
    console.log(`📤 Evento enviado (${eventName}):`, json);
  } catch (err) {
    console.error("❌ Erro ao enviar evento:", err);
  }
}

// ===== Endpoint de webhook =====
app.post("/webhook", async (req, res) => {
  const { lead, tag } = req.body;
  if (!lead || !tag) {
    return res.status(400).json({ error: "lead ou tag ausente" });
  }

  const eventName = mapTagToEvent(tag.name);
  console.log("📥 Webhook recebido:", req.body);

  await sendToMeta(eventName, lead);

  res.json({ status: "ok" });
});

// ===== Inicia servidor =====
app.listen(PORT, () => {
  console.log(`✅ Webhook rodando na porta ${PORT}`);
});
