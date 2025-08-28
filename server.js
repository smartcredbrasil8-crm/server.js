// server.js
import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// Configurações do Pixel e Token do Facebook
const PIXEL_ID = "568969266119506"; // substitua pelo seu Pixel
const ACCESS_TOKEN = "EAADU2T8mQZAUBPcsqtNZBWz4ae0GmoZAqRpmC3U2zdAlmpNTQR3yn9fFMr1vhuzZAQMlhE0vJ7eZBXfZAnFEVlxo57vhxEm9axplSs4zwUpV4EuOXcpYnefhuD0Wy44p9sZCFyxGLd61NM2sZBQGAZBRJXETR29Q3pqxGPZBLccMZAKFEhEZBZAbYMZB95QVcEqt5O7H33jQZDZD";

// Token de verificação do webhook
const VERIFY_TOKEN = "845239leirom#";

// Configuração do Supabase
const SUPABASE_URL = "https://xppedcvaylcimqkdmooo.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhwcGVkY3ZheWxjaW1xa2Rtb29vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0MTk0MjYsImV4cCI6MjA3MTk5NTQyNn0.NkkDk8AaWs15e6rPCFqdixfS8BEBG4czHCZVyc09T1A";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Função hash SHA256
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

// Envio de evento para Meta
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
        custom_data: { lead_status: status },
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

// Verificação do webhook do Facebook
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

// Receber eventos do Facebook Leadgen ou CRM
app.post("/webhook", async (req, res) => {
  const body = req.body;
  console.log("📥 Webhook recebido:", JSON.stringify(body, null, 2));

  // Processa os leads
  if (body.entry) {
    for (const entry of body.entry) {
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === "leadgen") {
            const lead = change.value;
            const status = "Lead";

            // Salvar mapping FacebookID <-> CRM ID no Supabase
            if (lead.facebookLeadId && lead.id) {
              const { data, error } = await supabase
                .from("lead_mapping")
                .upsert({
                  facebook_lead_id: lead.facebookLeadId,
                  crm_lead_id: lead.id,
                  email: lead.email || null,
                  phone: lead.phone || null,
                });
              if (error) console.error("❌ Erro Supabase:", error);
            }

            await sendEventToMeta(lead, status);
          }
        }
      }
    }
  }

  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`✅ Webhook rodando na porta ${PORT}`);
});
