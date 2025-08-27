// server.js
import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const PIXEL_ID = "568969266119506";
const ACCESS_TOKEN = "EAADU2T8mQZAUBPcsqtNZBWz4ae0GmoZAqRpmC3U2zdAlmpNTQR3yn9fFMr1vhuzZAQMlhE0vJ7eZBXfZAnFEVlxo57vhxEm9axplSs4zwUpV4EuOXcpYnefhuD0Wy44p9sZCFyxGLd61NM2sZBQGAZBRJXETR29Q3pqxGPZBLccMZAKFEhEZBZAbYMZB95QVcEqt5O7H33jQZDZD";

// Função para gerar hash SHA256
function hashSHA256(value) {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

// Mapeamento de tags para eventos do CRM
function mapTagToEvent(tag) {
  switch (tag.toLowerCase()) {
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

app.post("/webhook", async (req, res) => {
  const { lead, tag } = req.body;
  if (!lead || !tag) {
    return res.status(400).send({ error: "Payload inválido" });
  }

  const event_name = mapTagToEvent(tag.name);

  // Construindo payload para API de Conversões
  const payload = {
    data: [
      {
        event_name,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "system_generated",
        lead_id: lead.id.toString(),
        user_data: {
          ...(lead.email ? { em: hashSHA256(lead.email) } : {}),
          ...(lead.phone ? { ph: hashSHA256(lead.phone) } : {})
        }
      }
    ]
  };

  try {
    const response = await fetch(`https://graph.facebook.com/v23.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    console.log(`📤 Evento enviado (${event_name}):`, result);

    res.status(200).send({ success: true, fbResult: result });
  } catch (err) {
    console.error("Erro ao enviar evento:", err);
    res.status(500).send({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`✅ Webhook rodando na porta ${PORT}`));
