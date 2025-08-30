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
const GOOGLE_PRIVATE_KEY = process.env.-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCNgDsv2zxDWBMV\nbKlgoHn8Os6NtwV6VS4CUV8IHKxVNijZZW2XWI5bJiYB3PMy9zrch8aLY6sy19bH\nQSApfnW/p83hR9ls1Md9worDF/EoCq7frAPv6x/lIIGZUMpTu2GGLYZgOsX0Bwsy\n4KrAMGYARfg1WLGk6LZOQmm6FloUHkQiKJJxNZ7Gd4PNSYk/cA60Jaa3YiSCAdn0\ncMO/TIWny2jhR6gLt50WB5cj8kdln6imJwiePjhXvNXgP/LWa0Qe2PAD6jhPZCyc\nWl6ivkGNuunK17cyKNdmsdhDNtPMm38XEoqCI/2pRRZTkd2KYNK7gwCuWC4NBHVI\nRMSSPJY/AgMBAAECggEAAjZFdpeORx062yRiN3T6wzMmJHf+eW2YdQfRnP5ZwVFB\n7TgVMP785rbfdDsAgET2IhlrRKWPuRE/tciyWIO2EoNsh/+IChf/cFtYsPkQV4hn\nOG7ndtotmvbZn8xwBUQSH7dZeOqiSpDLn4V8ldmL1qhBW5Ah4sqSgwGtxm9wBA15\nHW7b6WyjFacy/1sXRaayAGfwNLq8l/BpI0R5LNDpNGK03vonZQ+vtI3O5+mpPwC1\n/dHJbTrIPLqzfDAS4n0cfOL1AVtgIU4ExZcbUIYKTTGNZdqoH9Oo+wS/DybhlSux\nWKgjGbgCBDSVkz0jfWtQmnbnr5BqvOz70H+OKGHWXQKBgQDGrOwreUmOvHVbdOKz\n9ESpKC7ZD4UFqG/w+UNLbrd/cMP6OslNbhH8JBiboIgnRUOltCsZiev4mTUsYUvV\nhyFH1z1twYuyTLOx+J73uTPC9rX170radbYFu5iFtaO1Az1Udte4v2qdX7QS6ctq\nZoNAtOTDeYLSiyuJbH9SfOta+wKBgQC2VCI0LCJorFuzg3vKfQdASiLg+rZvBExM\nw01YAhlUWki2Ec9YsB4g0pIJs3/TP3rfdHnPlzSFlRDKoev5r74vQV/QpHnja3nc\nkIWTu5mH5uRSFcIXdilnLPqRbDsaxozjsrmRc/xI3tfomHLu8LB2ODeAbmeV5J5j\nze+C1zlOjQKBgDgTou16ZHq3UuCnkz172s1sHB0ENmWsbzwy/v2RmJWN/KLqaNtE\nECt8/L0giI2dDUT+H5Qry8D1bX7DT6ZLZ+dhJ2ONV6LR5356UFRXn/aNsDpkelpD\nE0d29cv3wudarLrkeGsbDDqzQp58AwBbQvzGkjNiXrySr40wZJehzsR1AoGAQ5UD\n6JrDVlEs3GlMJU4atfXE3+eOX7AUKA/sR0bf5Khiczo+xPzi7f+fKgFizAanoNQn\noo7FZQ5P3wwNz8sYj6OHxGpy050u2lanbI8I5Zrr3pE6FEA0MI43gle/wLj/2BaT\nOhrn1IrlNM3tLCwC/I7x46UIuEK5gvz+Xl0wXLECgYBi0hZRN0LGp/QpNEKqCmCo\nx92rjCH5wCuRDrgrocZovt6IfJ24G2DF8peqwQnMgPNLCsFlC1rf4I6Y39FhdMpV\nFGa7+ZzvK6X++doIb9KIfdGzCPa1XQbJa49N6vDaPvnpFLcciLIO4XLZkyKk3nS3\nTuKzS1RQ0oBAT2kUOtIgOA==\n-----END PRIVATE KEY-----\n
.replace(/\\n/g, "\n");

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
