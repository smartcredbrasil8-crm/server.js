// Importa as bibliotecas necessárias para o projeto
const express = require('express');
const { google } = require('googleapis');
const axios = require('axios');
const crypto = require('crypto');

// Cria uma instância do Express e define a porta do servidor
const app = express();
const port = process.env.PORT || 3000;

// Middleware para entender dados JSON nas requisições
app.use(express.json());

// Função para mapear o evento do CRM para o evento do Facebook
const mapCRMEventToFacebookEvent = (crmEvent) => {
    switch (crmEvent.toUpperCase()) {
        case 'OPORTUNIDADE':
            return 'Em análise';
        case 'VÍDEO':
            return 'Qualificado';
        case 'VENCEMOS':
            return 'Convertido';
        default:
            return crmEvent;
    }
};

// Função principal que vai lidar com o webhook do seu CRM
app.post('/webhook', async (req, res) => {
    try {
        // Pega os dados enviados pelo webhook do CRM
        const leadData = req.body;
        
        // Usa os nomes dos campos que vieram no teste real
        const crmEventName = leadData.tag ? leadData.tag.name : null;
        
        if (!crmEventName) {
            console.log('Webhook recebido, mas sem nome de evento válido. Nenhuma ação será tomada.');
            return res.status(200).send('Webhook recebido, mas sem nome de evento.');
        }

        const facebookEventName = mapCRMEventToFacebookEvent(crmEventName);

        if (!leadData || !leadData.lead) {
            return res.status(400).send('Dados do lead ausentes no webhook.');
        }

        const PIXEL_ID = process.env.PIXEL_ID;
        const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
        const SPREADSHEET_ID = process.env.SPREADSHEET_ID; 
        const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
        const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

        const emailCRM = leadData.lead.email ? leadData.lead.email.toLowerCase() : null;
        const phoneCRM = leadData.lead.phone ? leadData.lead.phone.replace(/\D/g, '') : null;

        if (!emailCRM && !phoneCRM) {
            return res.status(400).send('E-mail ou telefone do lead ausentes.');
        }

        const auth = new google.auth.JWT(
            GOOGLE_CLIENT_EMAIL,
            null,
            GOOGLE_PRIVATE_KEY,
            ['https://www.googleapis.com/auth/spreadsheets.readonly']
        );
        const sheets = google.sheets({ version: 'v4', auth });

        // O código agora lê o intervalo simplificado de colunas A, B e C
        const range = 'Lead geral!A:C';
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range,
        });

        const rows = response.data.values;
        let facebookLeadId = null;

        if (rows.length) {
            rows.forEach(row => {
                // A ordem dos índices agora corresponde à nova ordem das colunas
                const sheetLeadId = row[0]; // Coluna A
                const sheetPhone = row[1] ? row[1].replace(/\D/g, '') : null; // Coluna B
                const sheetEmail = row[2] ? row[2].toLowerCase() : null; // Coluna C

                if (sheetEmail && emailCRM && sheetEmail === emailCRM) {
                    facebookLeadId = sheetLeadId;
                } else if (sheetPhone && phoneCRM && sheetPhone === phoneCRM) {
                    facebookLeadId = sheetLeadId;
                }
            });
        }
        
        if (!facebookLeadId) {
            console.log('ID do Facebook não encontrado para este lead. Nenhuma ação será tomada.');
            return res.status(200).send('ID do Facebook não encontrado.');
        }

        const emailHashed = crypto.createHash('sha256').update(emailCRM).digest('hex');

        const userData = {
            em: [emailHashed]
        };

        const eventData = {
            event_name: facebookEventName,
            event_time: Math.floor(Date.now() / 1000),
            user_data: userData,
            custom_data: {
                lead_id: facebookLeadId
            }
        };

        const facebookAPIUrl = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`;
        
        await axios.post(facebookAPIUrl, {
            data: [eventData]
        });

        console.log(`Evento '${facebookEventName}' disparado com sucesso para o lead com ID: ${facebookLeadId}`);
        res.status(200).send('Evento de conversão enviado com sucesso!');

    } catch (error) {
        console.error('Erro ao processar o webhook:', error.message);
        res.status(500).send('Erro interno do servidor.');
    }
});

app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});
