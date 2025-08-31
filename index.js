// Importa as bibliotecas necessárias para o projeto
const express = require('express');
const { Client } = require('pg');
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

// Conecta ao banco de dados e cria a tabela se ela não existir
const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

const initializeDatabase = async () => {
    try {
        await client.connect();
        console.log('Conexão com o banco de dados estabelecida.');
        await client.query(`
            CREATE TABLE IF NOT EXISTS leads (
                facebook_lead_id TEXT PRIMARY KEY,
                crm_id TEXT,
                email TEXT,
                phone TEXT
            );
        `);
        console.log('Tabela "leads" verificada/criada com sucesso.');
    } catch (err) {
        console.error('Erro ao conectar ou inicializar o banco de dados', err.message);
    }
};

initializeDatabase();

// NOVO ENDPOINT: Para importar leads para o banco de dados
app.post('/import-leads', async (req, res) => {
    const leadsToImport = req.body;
    if (!Array.isArray(leadsToImport) || leadsToImport.length === 0) {
        return res.status(400).send('Dados de importação ausentes ou formato inválido.');
    }

    try {
        const queryText = `
            INSERT INTO leads (facebook_lead_id, crm_id, email, phone)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (facebook_lead_id) DO UPDATE SET
                crm_id = EXCLUDED.crm_id,
                email = EXCLUDED.email,
                phone = EXCLUDED.phone;
        `;

        for (const lead of leadsToImport) {
            await client.query(queryText, [lead.facebook_lead_id, lead.crm_id, lead.email, lead.phone]);
        }

        res.status(201).send('Leads importados com sucesso!');
    } catch (error) {
        console.error('Erro ao importar leads:', error.message);
        res.status(500).send('Erro interno do servidor.');
    }
});

// ENDPOINT DO WEBHOOK: Onde o CRM envia o evento
app.post('/webhook', async (req, res) => {
    try {
        const leadData = req.body;
        const crmEventName = leadData.tag ? leadData.tag.name : null;
        
        if (!crmEventName) {
            console.log('Webhook recebido, mas sem nome de evento válido. Nenhuma ação será tomada.');
            return res.status(200).send('Webhook recebido, mas sem nome de evento.');
        }

        const facebookEventName = mapCRMEventToFacebookEvent(crmEventName);

        if (!leadData || !leadData.lead || !leadData.lead.id) {
            return res.status(400).send('Dados do lead ausentes no webhook.');
        }

        const crmId = leadData.lead.id;
        
        // Busca o ID do Facebook no banco de dados usando o ID do CRM
        const result = await client.query(
            'SELECT facebook_lead_id, email, phone FROM leads WHERE crm_id = $1',
            [crmId]
        );

        if (result.rows.length === 0) {
            console.log('ID do Facebook não encontrado para este lead no banco de dados.');
            return res.status(200).send('ID do Facebook não encontrado.');
        }

        const facebookLeadId = result.rows[0].facebook_lead_id;
        const leadEmail = result.rows[0].email;
        const leadPhone = result.rows[0].phone;

        const PIXEL_ID = process.env.PIXEL_ID;
        const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
        
        const emailHashed = leadEmail ? crypto.createHash('sha256').update(leadEmail).digest('hex') : null;
        const phoneHashed = leadPhone ? crypto.createHash('sha256').update(leadPhone).digest('hex') : null;

        const userData = {};
        if (emailHashed) userData.em = [emailHashed];
        if (phoneHashed) userData.ph = [phoneHashed];

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
