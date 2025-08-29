// server.js
import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// =========================
// CONFIGURAÇÕES FACEBOOK
// =========================
const PIXEL_ID = "568969266119506";
const ACCESS_TOKEN = "EAADU2T8mQZAUBPRbatdIN038ucTUcp7O8tENhNCZBvX5LCGBzpcawiN7ZAiTG75X9o5cbJP8Kc2BZAoo3FEJGtZAzCEuXNxPpWEoYxGnbfuBleZAnfthkWmMENBRsB5u2rD2DBB7Q36t2tSRhec8tZA2IKt5h2EzSonvy6oClmbVH6lGaVRsB7xcdUkpsZCLv8ZCw3AZDZD";
const VERIFY_TOKEN = "845239leirom#";

// =========================
// CONFIGURAÇÕES SUPABASE
// =========================
const SUPABASE_URL = "https://xppedcvaylcimqkdmooo.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhwcGVkY3ZheWxjaW1xa2Rtb29vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0MTk0MjYsImV4cCI6MjA3MTk5NTQyNn0.NkkDk8AaWs15e6rPCFqdixfS8BEBG4czHCZVyc09T1A";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// =========================
// FUNÇÕES AUXILIARES
// =========================
function hashSHA256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// Mapear tags/status para eventos do Pixel
function mapStatusToEvent(status) {
  switch (status.toLowerCase()) {
    case "oportunidade":
      return "Em análise";
    case "qualificado":
    case "video":
      return "Qualificado";
    case "convertido":
    case "vencemos":
      return "Convertido";
    default:
      return "Lead";
  }
}

// Enviar evento para o Pixel
async function sendEventToMeta(lead, status) {
  const facebookLeadId = lead.facebookLeadId || lead.leadgen_id;

  if (!facebookLeadId) {
    console.error("❌ Lead sem facebookLeadId. Evento não enviado.");
    return;
  }

  const payload = {
    data: [
      {
        event_name: mapStatusToEvent(status),
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
  } catch (err) {
    console.error("❌ Erro ao enviar evento:", err);
  }
}

// Salvar ou atualizar lead no Supabase
async function upsertLead(facebookLeadId, crmLeadId, email, phone, status) {
  try {
    const { data, error } = await supabase
      .from("leads")
      .upsert(
        {
          facebook_lead_id: facebookLeadId,
          crm_lead_id: crmLeadId,
          email,
          phone,
          status,
        },
        { onConflict: ["facebook_lead_id"] }
      );
    if (error) throw error;
    console.log("💾 Lead salvo no Supabase:", data);
  } catch (err) {
    console.error("❌ Erro no Supabase:", err);
  }
}

// =========================
// WEBHOOK FACEBOOK
// =========================
app.get("/webhook/facebook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook Facebook verificado!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook/facebook", async (req, res) => {
  const body = req.body;
  console.log("📥 Webhook Facebook recebido:", JSON.stringify(body, null, 2));

  if (body.entry) {
    for (const entry of body.entry) {
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === "leadgen") {
            const lead = change.value;
            const status = "Lead";
            await sendEventToMeta(lead, status);
            await upsertLead(
              lead.leadgen_id,
              lead.id || null,
              lead.email,
              lead.phone,
              status
            );
          }
        }
      }
    }
  }
  res.json({ success: true });
});

// =========================
// WEBHOOK CRM
// =========================
app.post("/webhook/crm", async (req, res) => {
  const body = req.body;
  console.log("📥 Webhook CRM recebido:", JSON.stringify(body, null, 2));

  const lead = body.lead;
  const status = body.status || "Em análise";

  if (lead) {
    await sendEventToMeta(lead, status);
    await upsertLead(
      lead.facebookLeadId,
      lead.crmLeadId,
      lead.email,
      lead.phone,
      status
    );
  }

  res.json({ success: true });
});

// =========================
// INICIAR SERVIDOR
// =========================
app.listen(PORT, () => {
  console.log(`✅ Webhook rodando na porta ${PORT}`);
});
