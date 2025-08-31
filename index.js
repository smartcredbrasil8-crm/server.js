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
    switch (crmEvent) {
        case 'Oportunidade':
            return 'Em análise';
        case 'Vídeo':
            return 'Qualificado';
        case 'Vencemos':
            return 'Convertido';
        default:
            return crmEvent; // Retorna o próprio nome do evento se não houver um mapeamento
    }
};

// Função principal que vai lidar com o webhook do seu CRM
app.post('/webhook', async (req, res) => {
    try {
        // Pega os dados enviados pelo webhook do CRM
        const leadData = req.body;
        
        // CORREÇÃO: O nome do evento está em 'marcação.nome', não 'stage_name'
        const crmEventName = leadData.marcação.nome; 
        
        // Mapeia o evento do CRM para o evento do Facebook
        const facebookEventName = mapCRMEventToFacebookEvent(crmEventName);

        // Se o webhook não tiver os dados necessários, retorna um erro
        if (!leadData || !leadData.liderar) {
            return res.status(400).send('Dados do lead ausentes no webhook.');
        }

        // Pega as variáveis de ambiente que você configurou no Render
        const PIXEL_ID = process.env.PIXEL_ID;
        const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
        const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
        const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
        const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

        // Pega o e-mail e o telefone do lead
        const emailCRM = leadData.liderar.e-mail ? leadData.liderar.e-mail.toLowerCase() : null;
        const phoneCRM = leadData.liderar.telefone ? leadData.liderar.telefone.replace(/\D/g, '') : null;

        if (!emailCRM && !phoneCRM) {
            return res.status(400).send('E-mail ou telefone do lead ausentes.');
        }

        // Configura a autenticação com a API do Google Sheets
        const auth = new google.auth.JWT(
            GOOGLE_CLIENT_EMAIL,
            null,
            GOOGLE_PRIVATE_KEY,
            ['https://www.googleapis.com/auth/spreadsheets.readonly']
        );
        const sheets = google.sheets({ version: 'v4', auth });

        // Lê a planilha para encontrar o ID original do Facebook
        const range = 'Página1!A:C'; // Altere 'Página1' para o nome da sua aba na planilha
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range,
        });

        const rows = response.data.values;
        let facebookLeadId = null;

        if (rows.length) {
            // Percorre cada linha da planilha para encontrar a correspondência
            rows.forEach(row => {
                const sheetEmail = row[0] ? row[0].toLowerCase() : null;
                const sheetPhone = row[1] ? row[1].replace(/\D/g, '') : null;
                const sheetLeadId = row[2]; // Supondo que a coluna C tenha o ID do Facebook

                if (sheetEmail && emailCRM && sheetEmail === emailCRM) {
                    facebookLeadId = sheetLeadId;
                } else if (sheetPhone && phoneCRM && sheetPhone === phoneCRM) {
                    facebookLeadId = sheetLeadId;
                }
            });
        }
        
        // Se não encontrar o ID do Facebook na planilha, não faz nada
        if (!facebookLeadId) {
            console.log('ID do Facebook não encontrado para este lead. Nenhuma ação será tomada.');
            return res.status(200).send('ID do Facebook não encontrado.');
        }

        // Se encontrar o ID, prepara os dados para enviar ao Facebook
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

        // Dispara o evento de conversão para a API do Facebook
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

// Inicia o servidor para escutar as requisições
app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});
