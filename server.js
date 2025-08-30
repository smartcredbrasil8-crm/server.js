import express from "express";
import fetch from "node-fetch";
import { GoogleSpreadsheet } from "google-spreadsheet";

const app = express();
app.use(express.json());

// Variáveis de ambiente
const PORT = process.env.PORT || 10000;
const PIXEL_ID = process.env.PIXEL_ID;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;

// Validação da Private Key
if (!process.env.GOOGLE_PRIVATE_KEY) {
  throw new Error("❌ Variável de ambiente GOOGLE_PRIVATE_KEY não encontrada!");
}

// Substitui os \n pela quebra de linha real
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");

// Inicializando Google Sheets dentro de função async
const doc = new GoogleSpreadsheet(SPREADSHEET_ID);
async function initGoogleDoc() {
  try {
    await doc.useServiceAccountAuth({
      client_email: GOOGLE_CLIENT_EMAIL,
      private_key: GOOGLE_PRIVATE_KEY,
    });
    await doc.loadInfo();
    console.log("✅ Google Sheets conectado:", doc.title);
  } catch (err) {
    console.error("❌ Erro ao conectar Google Sheets:", err);
  }
}
initGoogleDoc();

// Função para buscar lead na planilha pelo e-mail ou telefone
async function getLeadFromSheet(email, phone) {
  const sheet = doc.sheetsByIndex[0];
  const rows = await sheet.getRows();
  return rows.find(
    (row) =>
      (email && row.email === email) || (phone && row.telefone === phone)
  );
}

// Função para enviar evento para Pixel
async function sendPixelEvent(eventName, leadId, email, phone) {
  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        user_data: {
          em: email ? [email] : undefined,
          ph: phone ? [phone] : undefined,
        },
        event_source_url: "https://www.seusite.com",
        action_source: "website",
        external_id: leadId,
      },
    ],
  };

  const url = `https://graph.facebook.com/v17.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    console.log("Evento enviado:", json);
  } catch (err) {
    console.error("Erro ao enviar evento:", err);
  }
}

// Webhook do CRM recebendo status do lead
app.post("/webhook", async (req, res) => {
  try {
    const { email, telefone, status, crmLeadId } = req.body;

    const leadSheet = await getLeadFromSheet(email, telefone);

    if (!leadSheet) {
      console.log("Lead não encontrado na planilha.");
      return res.status(404).send("Lead não encontrado");
    }

    let eventName;
    switch (status) {
      case "Oportunidade":
        eventName = "Em análise";
        break;
      case "Vídeo":
        eventName = "Qualificado";
        break;
      case "Vencemos":
        eventName = "Convertido";
        break;
      default:
        console.log("Status não mapeado:", status);
        return res.status(400).send("Status não mapeado");
    }

    await sendPixelEvent(eventName, leadSheet.id_facebook, email, telefone);

    res.status(200).send("Evento processado");
  } catch (err) {
    console.error("Erro no webhook:", err);
    res.status(500).send("Erro interno");
  }
});

app.listen(PORT, () => {
  console.log(`✅ Webhook rodando na porta ${PORT}`);
});
