import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ===== Variáveis de ambiente =====
const ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN; // Token do Facebook
const PIXEL_ID = process.env.FB_PIXEL_ID;        // ID do Pixel

// ===== 1️⃣ Verificação do Webhook =====
const VERIFY_TOKEN = "smartcred_webhook";

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook validado com sucesso!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ===== 2️⃣ Receber leads do Facebook =====
function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}
function normalizeEmail(email) { return email.trim().toLowerCase(); }
function normalizePhone(phone) { return phone.replace(/\D/g, ""); }

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const leadId = changes?.value?.leadgen_id;

    const fieldData = changes?.value?.field_data || [];
    const lead = {};
    fieldData.forEach(f => {
      if (f.name === "email") lead.email = f.values[0];
      if (f.name === "phone_number") lead.phone = f.values[0];
      if (f.name === "first_name") lead.firstName = f.values[0];
      if (f.name === "last_name") lead.lastName = f.values[0];
    });

    const user_data = {
      em: lead.email ? sha256(normalizeEmail(lead.email)) : undefined,
      ph: lead.phone ? sha256(normalizePhone(lead.phone)) : undefined,
      fn: lead.firstName ? sha256(lead.firstName.trim().toLowerCase()) : undefined,
      ln: lead.lastName ? sha256(lead.lastName.trim().toLowerCase()) : undefined,
      external_id: leadId ? sha256(leadId) : undefined
    };

    Object.keys(user_data).forEach(key => {
      if (!user_data[key]) delete user_data[key];
    });

    const payload = {
      data: [
        {
          event_name: "Lead",
          event_time: Math.floor(Date.now() / 1000),
          action_source: "lead_ads",
          user_data
        }
      ]
    };

    const response = await fetch(
      `https://graph.facebook.com/v23.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    const result = await response.json();
    console.log("Resposta do Conversions API:", result);

    res.status(200).send("Webhook processado com sucesso");
  } catch (error) {
    console.error("Erro no webhook:", error);
    res.status(500).send("Erro interno");
  }
});

// ===== 3️⃣ Inicia servidor =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
