// server.js
import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// Configurações do seu Pixel e Token
const PIXEL_ID = "568969266119506";
const ACCESS_TOKEN = "EAADU2T8mQZAUBPcsqtNZBWz4ae0GmoZAqRpmC3U2zdAlmpNTQR3yn9fFMr1vhuzZAQMlhE0vJ7eZBXfZAnFEVlxo57vhxEm9axplSs4zwUpV4EuOXcpYnefhuD0Wy44p9sZCFyxGLd61NM2sZBQGAZBRJXETR29Q3pqxGPZBLccMZAKFEhEZBZAbYMZB95QVcEqt5O7H33jQZDZD";

// Função para hash SHA256 (Meta exige hashing)
function hashSHA256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// Mapear tags do Greenn Sales para eventos do CRM
function mapTagToStatus(tagName) {
  switch (tagName.toLowerCase()) {
    case "oportunidade":
      return "Em análise";
    case "video":
      return "Qualificado";
    case "vencemos":
      return "Convertido";
    default:
      return "Evento personalizado";
  }
}

// Função para enviar evento para a API de Conversões
async function sendEventToMeta(lead, status) {
  // Criar payload
  const payload = {
    data: [
      {
        event_name: status,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "system_generated",
        user_data: {
          lead_id: String(lead.id),
          em: lead.email ? hashSHA256(lead.email.toLowerCase()) : undefined,
          ph: lead.phone ? hashSHA256(lead.phone.replace(/\D/g, "")) : undefined,
        },
        custom_data: {
          lead_status: status,
        },
      },
    ],
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/v23.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      }
    );

    const json = await res.json();
    console.log(`📤 Evento enviado (${status}):`, JSON.stringify(json, null, 2));
  } catch (error) {
    console.error("❌ Erro ao enviar evento:", error);
  }
}

// Rota webhook para receber eventos do Greenn Sales
app.post("/webhook", async (req, res) => {
  const body = req.body;
  console.log("📥 Webhook recebido:", JSON.stringify(body, null, 2));

  const lead = body.lead;
  const tag = body.tag;

  if (!lead || !tag) {
    return res.status(400).json({ error: "Lead ou Tag ausente" });
  }

  const status = mapTagToStatus(tag.name);
  await sendEventToMeta(lead, status);

  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`✅ Webhook rodando na porta ${PORT}`);
});
