// Importa as bibliotecas necessárias para o projeto
const express = require('express');
const { Client } = require('pg');
const axios = require('axios');
const crypto = require('crypto');

// Cria uma instância do Express e define a porta do servidor
const app = express();
const port = process.env.PORT || 3000;

// Middleware para entender dados JSON, com limite aumentado para 50mb
app.use(express.json({ limit: '50mb' }));

// Função para mapear o evento do CRM para o evento do Facebook
const mapCRMEventToFacebookEvent = (crmEvent) => {
    switch (crmEvent.toUpperCase()) {
        case 'NOVOS': return 'Lead';
        case 'ATENDEU': return 'Atendeu';
        case 'OPORTUNIDADE': return 'Oportunidade';
        case 'AVANÇADO': return 'Avançado';
        case 'VÍDEO': return 'Vídeo';
        case 'VENCEMOS': return 'Vencemos';
        case 'QUER EMPREGO': return 'Desqualificado';
        case 'QUER EMPRESTIMO': return 'Não Qualificado';
        default: return crmEvent;
    }
};

// Conecta ao banco de dados usando o método original de Client único
const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

const initializeDatabase = async () => {
    try {
        await client.connect();
        console.log('Conexão com o banco de dados estabelecida (método Client).');

        await client.query(`
            CREATE TABLE IF NOT EXISTS leads (
                facebook_lead_id TEXT PRIMARY KEY,
                phone TEXT,
                email TEXT
            );
        `);
        console.log('Tabela "leads" verificada/criada com sucesso.');

        // Lógica ATUALIZADA para verificar e adicionar as NOVAS colunas
        const columns = {
            'first_name': 'TEXT',
            'last_name': 'TEXT',
            'dob': 'TEXT',
            'city': 'TEXT',
            'estado': 'TEXT',
            'zip_code': 'TEXT'
        };

        for (const [columnName, columnType] of Object.entries(columns)) {
            const check = await client.query("SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name=$1", [columnName]);
            if (check.rows.length === 0) {
                await client.query(`ALTER TABLE leads ADD COLUMN ${columnName} ${columnType};`);
                console.log(`Coluna "${columnName}" adicionada à tabela "leads".`);
            }
        }

    } catch (err) {
        console.error('Erro ao conectar ou inicializar o banco de dados:', err.message);
    }
};

initializeDatabase();

// ENDPOINT de importação com lógica para as NOVAS colunas
app.post('/import-leads', async (req, res) => {
    const leadsToImport = req.body;
    if (!Array.isArray(leadsToImport)) {
        return res.status(400).send('Formato inválido.');
    }
    try {
        const queryText = `
            INSERT INTO leads (facebook_lead_id, email, phone, first_name, last_name, dob, city, estado, zip_code)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (facebook_lead_id) DO UPDATE SET
                email = EXCLUDED.email, phone = EXCLUDED.phone, first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name, dob = EXCLUDED.dob, city = EXCLUDED.city,
                estado = EXCLUDED.estado, zip_code = EXCLUDED.zip_code;
        `;
        for (const lead of leadsToImport) {
            if (!lead || !lead.facebook_lead_id) continue;
            await client.query(queryText, [
                lead.facebook_lead_id, lead.email || null, (lead.phone || '').replace(/\D/g, ''),
                lead.first_name || null, lead.last_name || null, lead.dob || null,
                lead.city || null, lead.estado || null, lead.zip_code || null
            ]);
        }
        res.status(201).send('Leads importados com sucesso!');
    } catch (error) {
        console.error('Erro ao importar leads:', error.message);
        res.status(500).send('Erro interno do servidor.');
    }
});


// ENDPOINT do Webhook com a lógica ATUALIZADA para as NOVAS colunas
app.post('/webhook', async (req, res) => {
    console.log("--- Webhook recebido ---");
    try {
        const leadData = req.body;
        const crmEventName = leadData.tag ? leadData.tag.name : null;
        if (!crmEventName) {
            return res.status(200).send('Webhook recebido, mas sem nome de evento.');
        }

        const facebookEventName = mapCRMEventToFacebookEvent(crmEventName);
        if (!leadData.lead) {
            return res.status(400).send('Dados do lead ausentes.');
        }

        const leadEmail = leadData.lead.email ? leadData.lead.email.toLowerCase() : null;
        const leadPhone = leadData.lead.phone ? leadData.lead.phone.replace(/\D/g, '') : null;
        if (!leadEmail && !leadPhone) {
            return res.status(400).send('E-mail ou telefone ausentes.');
        }

        console.log(`Buscando no banco por email: ${leadEmail} ou telefone: ${leadPhone}`);
        const result = await client.query(
            'SELECT facebook_lead_id, first_name, last_name, dob, city, estado, zip_code FROM leads WHERE email = $1 OR phone = $2',
            [leadEmail, leadPhone]
        );

        if (result.rows.length === 0) {
            console.log('Lead não encontrado no banco.');
            return res.status(200).send('ID do Facebook não encontrado.');
        }

        const dbRow = result.rows[0];
        console.log('Lead encontrado. Preparando evento para o Facebook.');

        const PIXEL_ID = process.env.PIXEL_ID;
        const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
        if(!PIXEL_ID || !FB_ACCESS_TOKEN) {
            console.error('ERRO: PIXEL_ID ou FB_ACCESS_TOKEN não configurados!');
            return res.status(500).send('Erro de configuração no servidor.');
        }
        
        // Lógica de HASH ATUALIZADA com as novas colunas
        const userData = {};
        if (leadEmail) userData.em = [crypto.createHash('sha256').update(leadEmail).digest('hex')];
        if (leadPhone) userData.ph = [crypto.createHash('sha256').update(leadPhone).digest('hex')];
        if (dbRow.first_name) userData.fn = [crypto.createHash('sha256').update(dbRow.first_name.toLowerCase()).digest('hex')];
        if (dbRow.last_name) userData.ln = [crypto.createHash('sha256').update(dbRow.last_name.toLowerCase()).digest('hex')];
        if (dbRow.dob) userData.db = [crypto.createHash('sha256').update(String(dbRow.dob).replace(/\D/g, '')).digest('hex')];
        if (dbRow.city) userData.ct = [crypto.createHash('sha256').update(dbRow.city.toLowerCase()).digest('hex')];
        if (dbRow.estado) userData.st = [crypto.createHash('sha256').update(dbRow.estado.toLowerCase()).digest('hex')];
        if (dbRow.zip_code) userData.zp = [crypto.createHash('sha256').update(String(dbRow.zip_code).replace(/\D/g, '')).digest('hex')];

        const eventData = { event_name: facebookEventName, event_time: Math.floor(Date.now() / 1000), action_source: 'system_generated', user_data: userData, custom_data: { lead_id: dbRow.facebook_lead_id } };
        const facebookAPIUrl = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`;
        
        await axios.post(facebookAPIUrl, { data: [eventData] });
        console.log(`Evento '${facebookEventName}' disparado para o lead ID: ${dbRow.facebook_lead_id}`);
        res.status(200).send('Evento enviado com sucesso!');

    } catch (error) {
        if (error.response) {
            console.error('Erro na API do Facebook:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Erro ao processar o webhook:', error.message);
        }
        res.status(500).send('Erro interno do servidor.');
    }
});

app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});
