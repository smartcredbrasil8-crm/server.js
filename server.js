import express from "express";
import bodyParser from "body-parser";
import { google } from "googleapis";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

// Configuração das variáveis de ambiente
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PIXEL_ID = process.env.PIXEL_ID;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
import fs from "fs";

const credentials = JSON.parse(
  fs.readFileSync("./config/google-credentials.json", "utf-8")
);

const GOOGLE_PRIVATE_KEY = credentials.private_key;
const GOOGLE_CLIENT_EMAIL = credentials.client_email;


// Middleware
app.use(bodyParser.json());

// Autenticação Google Sheets
const auth = new google.auth.JWT({
  email: GOOGLE_CLIENT_EMAIL,
  key: GOOGLE_PRIVATE_KEY,
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const sheets = google.sheets({ version: "v4", auth });

// Função para buscar lead na planilha pelo e-mail ou telefone
async function buscarLeadPlanilha(email, phone) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Leads!A:F", // ajuste para o intervalo correto
  });

  const rows = res.data.values;
  if (!rows || rows.length === 0) return null;

  for (const row of rows) {
    const [leadId, leadEmail, leadPhone, campaignId, adSetId, adId] = row;
    if (
      (email && email === leadEmail) ||
      (phone && phone === leadPhone)
    ) {
      return { leadId, campaignId, adSetId, adId };
    }
  }
  return null;
}

// Mapeamento dos eventos CRM -> Pixel
function mapEventoCRM(eventoCRM) {
  switch (eventoCRM) {
    case "Oportunidade":
      return "Em análise";
    case "Vídeo":
      return "Qualificado";
    case "Vencemos":
      return "Convertido";
    default:
      return null;
  }
}

// Endpoint para receber webhook do CRM
app.post("/webhook", async (req, res) => {
  try {
    const { email, phone, evento } = req.body;

    if (!evento || (!email && !phone)) {
      return res.status(400).json({ error: "Dados incompletos" });
    }

    const lead = await buscarLeadPlanilha(email, phone);
    if (!lead) {
      return res.status(404).json({ error: "Lead não encontrado na planilha" });
    }

    const eventoPixel = mapEventoCRM(evento);
    if (!eventoPixel) {
      return res.status(400).json({ error: "Evento CRM não mapeado" });
    }

    // Envio do evento para o Pixel via API de conversão
    const payload = {
      data: [
        {
          event_name: eventoPixel,
          event_time: Math.floor(Date.now() / 1000),
          event_source_url: "https://yourdomain.com",
          user_data: {
            em: email ? [email] : [],
            ph: phone ? [phone] : [],
          },
          custom_data: {
            campaign_id: lead.campaignId,
            adset_id: lead.adSetId,
            ad_id: lead.adId,
          },
        },
      ],
    };

    const response = await fetch(`https://graph.facebook.com/v17.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    console.log("Evento enviado:", result);

    res.status(200).json({ status: "ok", result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro interno" });
  }
});

// Health check
app.get("/", (req, res) => {
  res.send("Webhook rodando na porta " + PORT);
});

// Start server
app.listen(PORT, () => {
  console.log("✅ Webhook rodando na porta", PORT);
});
