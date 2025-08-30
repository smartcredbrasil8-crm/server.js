import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import crypto from "crypto";
import { google } from "googleapis";

const app = express();
app.use(bodyParser.json());

// 🔑 Variáveis de ambiente
const PIXEL_ID = process.env.PIXEL_ID;
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;

// Google Sheets
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");

// Inicializa Google Sheets API
const auth = new google.auth.JWT(
  GOOGLE_CLIENT_EMAIL,
  null,
  GOOGLE_PRIVATE_KEY,
  ["https://www.googleapis.com/auth/spreadsheets.readonly"]
);
const sheets = google.sheets({ version: "v4", auth });

// Hash para email/telefone (Facebook exige)
function hash(data) {
  return crypto.createHash("sha256").update(data.trim().toLowerCase()).digest("hex");
}

// Buscar Lead no Google Sheets
async function buscarLeadNaPlanilha(email, phone) {
  try {
    const range = "Leads!A:D"; // Ajuste para a aba/colunas certas
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range,
    });

    const rows = res.data.values;
    if (!rows || rows.length === 0) return null;

    // Supondo colunas: [LeadID_FB, Email, Telefone, CRM_ID]
    for (let row of rows) {
      const [leadIdFB, emailPlanilha, telefonePlanilha] = row;

      if (
        (email && emailPlanilha && emailPlanilha.toLowerCase() === email.toLowerCase()) ||
        (phone && telefonePlanilha && telefonePlanilha === phone)
      ) {
        return leadIdFB;
      }
    }
    return null;
  } catch (err) {
    console.error("Erro ao buscar lead na planilha:", err);
    return null;
  }
}

// Webhook CRM → Facebook
app.post("/webhook", async (req, res) => {
  try {
    const { lead_id_crm, email, phone, status } = req.body;

    console.log("📥 Webhook recebido:", req.body);

    // Buscar LeadID_FB pela planilha
    const fb_lead_id = await buscarLeadNaPlanilha(email, phone);

    // Mapear status do CRM para eventos
    let eventName = "Lead";
    if (status === "Oportunidade") eventName = "Em análise";
    else if (status === "Vídeo") eventName = "Qualificado";
    else if (status === "Vencemos") eventName = "Convertido";

    // Evento pronto
    const event = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          user_data: {
            em: email ? [hash(email)] : [],
            ph: phone ? [hash(phone)] : [],
          },
          custom_data: { crm_id: lead_id_crm },
          event_source_url: "https://seusite.com",
          action_source: "crm",
          event_id: fb_lead_id || lead_id_crm,
        },
      ],
    };

    console.log("📤 Enviando evento:", event);

    // Chamada API do Facebook
    const response = await fetch(
      `https://graph.facebook.com/v17.0/${PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`,
      {
        method: "POST",
        body: JSON.stringify(event),
        headers: { "Content-Type": "application/json" },
      }
    );

    const data = await response.json();
    console.log("✅ Resposta Facebook:", data);

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    res.sendStatus(500);
  }
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
