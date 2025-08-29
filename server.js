// server.js
import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// ===============================
// CONFIGURAÇÕES
// ===============================

// Substitua pelos seus valores reais
const PIXEL_ID = "SEU_PIXEL_ID_AQUI";
const ACCESS_TOKEN = "SEU_ACCESS_TOKEN_AQUI";
const VERIFY_TOKEN = "SUA_STRING_VERIFICACAO_AQUI";

// Supabase
const SUPABASE_URL = "https://SEU_PROJECT_ID.supabase.co";
const SUPABASE_KEY = "SEU_ANON_KEY";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ===============================
// FUNÇÕES AUXILIARES
// ===============================

// Hash SHA256 exigido pelo Meta para dados pessoais
function hashSHA256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// Mapeia tags do CRM para status
function mapTagToStatus(tagName) {
  switch ((tagName || "").toLowerCase()) {
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

// Envia evento para o Meta Pixel
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

// Salva ou atualiza lead no Supabase
async function upsertLead(facebookLeadId, crmLeadId, email, phone, status) {
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
  if (error) console.error("❌ Erro no Supabase:", error);
  else console.log("💾 Lead salvo no Supabase:", data);
}

// ===============================
// ENDPOINTS
// ===============================

// Verificação do webhook do Facebook
app.get("/webhook/facebook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook do Facebook verificado!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Recebe leads do Facebook
app.post("/webhook/facebook", async (req, res) => {
  const body = req.body;
  console.log("📥 Webhook do Facebook recebido:", JSON.stringify(body, null, 2));

  if (body.entry) {
    body.entry.forEach(async (entry) => {
      if (entry.changes) {
        entry.changes.forEach(async (change) => {
          if (change.field === "leadgen") {
            const lead = change.value;
            const status = "Lead"; // padrão do Facebook
            await sendEventToMeta(lead, status);
            await upsertLead(
              lead.leadgen_id,
              null,
              lead.email,
              lead.phone,
              status
            );
          }
        });
      }
    });
  }

  res.json({ success: true });
});

// Recebe updates do CRM
app.post("/webhook/crm", async (req, res) => {
  const body = req.body;
  console.log("📥 Webhook do CRM recebido:", JSON.stringify(body, null, 2));

  // Supondo que o CRM envia facebookLeadId e crmLeadId
  const lead = body.lead;
  const status = mapTagToStatus(body.status);

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

// ===============================
// INICIAR SERVIDOR
// ===============================
app.listen(PORT, () => {
  console.log(`✅ Webhook rodando na porta ${PORT}`);
});
