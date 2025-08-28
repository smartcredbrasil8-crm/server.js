// server.js
import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// Configurações do Pixel e Token (substitua pelos seus valores reais)
const PIXEL_ID = "568969266119506";
const ACCESS_TOKEN = "EAADU2T8mQZAUBPcsqtNZBWz4ae0GmoZAqRpmC3U2zdAlmpNTQR3yn9fFMr1vhuzZAQMlhE0vJ7eZBXfZAnFEVlxo57vhxEm9axplSs4zwUpV4EuOXcpYnefhuD0Wy44p9sZCFyxGLd61NM2sZBQGAZBRJXETR29Q3pqxGPZBLccMZAKFEhEZBZAbYMZB95QVcEqt5O7H33jQZDZD";

// Token de verificação do webhook (crie uma string segura)
const VERIFY_TOKEN = "845239leirom#";

// Função para hash SHA256 (Meta exige hashing para dados pessoais)
function hashSHA256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// Mapeamento de tags para status
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

// Função para enviar evento para a API de Conversões do Meta
async function sendEventToMeta(lead, status) {
  const facebookLeadId = lead.facebookLeadId || lead.leadgen_id;

  if (!facebookLeadId) {
    console.error("❌ Lead sem lead_id do Facebook. Evento não enviado.");
    return;
  }

  const payload = {
    data: [
      {
        event_name: status,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "system_generated",
        user_data: {
          lead_id: String(facebookLeadId),
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

// Endpoint de verificação do webhook (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook verificado com sucesso!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Endpoint para receber eventos do Facebook (POST)
app.post("/webhook", async (req, res) => {
  const body = req.body;
  console.log("📥 Webhook recebido:", JSON.stringify(body, null, 2));

  // Para leadgen, os dados estão em "entry.changes.value"
  if (body.entry) {
    body.entry.forEach(async (entry) => {
      if (entry.changes) {
        entry.changes.forEach(async (change) => {
          if (change.field === "leadgen") {
            const lead = change.value;
            const status = "Lead"; // ou use mapTagToStatus se tiver tags
            await sendEventToMeta(lead, status);
          }
        });
      }
    });
  }

  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`✅ Webhook rodando na porta ${PORT}`);
});
