// server.js
import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// Configurações do Pixel e Token
const PIXEL_ID = process.env.PIXEL_ID;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

// Token de verificação do webhook
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "845239leirom#";

// Configuração do Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Função para hash SHA256
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
      return "Lead";
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

  if (body.entry) {
    for (const entry of body.entry) {
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === "leadgen") {
            const lead = change.value;
            const status = "Lead";

            // 👉 Salvar lead no Supabase
            const { error } = await supabase.from("leads").insert([
              {
                facebook_lead_id: lead.leadgen_id,
                email: lead.email || null,
                phone: lead.phone || null,
                status: status,
                source: "facebook",
              },
            ]);

            if (error) {
              console.error("❌ Erro ao salvar no Supabase:", error);
            } else {
              console.log("✅ Lead salvo no Supabase:", lead.leadgen_id);
            }

            // 👉 Enviar evento para o Meta
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
