// Importa as bibliotecas necessárias para o projeto
const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const crypto = require('crypto');

// Cria uma instância do Express e define a porta do servidor
const app = express();
// Render define a porta pela variável de ambiente PORT. Usar 10000 como padrão.
const port = process.env.PORT || 10000;

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

// Cria um Pool de conexões com o banco de dados
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Função para inicializar o banco de dados (verificar/criar tabelas e colunas)
const initializeDatabase = async () => {
    try {
        const checkClient = await pool.connect();
        console.log('Conexão com o pool do banco de dados estabelecida.');
        checkClient.release(); 

        await pool.query(`
            CREATE TABLE IF NOT EXISTS leads (
                facebook_lead_id TEXT PRIMARY KEY,
                phone TEXT,
                email TEXT
            );
        `);
        console.log('Tabela "leads" verificada/criada com sucesso.');

        const columns = {
            'first_name': 'TEXT',
            'last_name': 'TEXT',
            'dob': 'TEXT',
            'city': 'TEXT',
            'estado': 'TEXT',
            'zip_code': 'TEXT'
        };

        for (const [columnName, columnType] of Object.entries(columns)) {
            const check = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name=$1", [columnName]);
            if (check.rows.length === 0) {
                await pool.query(`ALTER TABLE leads ADD COLUMN ${columnName} ${columnType};`);
                console.log(`Coluna "${columnName}" adicionada à tabela "leads".`);
            }
        }

    } catch (err) {
        console.error('Erro ao conectar ou inicializar o banco de dados:', err.message);
    }
};

// Chama a função de inicialização ao iniciar o servidor
initializeDatabase();

// ENDPOINT: Rota para exibir o formulário de importação
app.get('/importar', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Importar Leads</title> ... </head>
        <body> ... </body>
        </html>
    `); // O HTML do formulário continua o mesmo
});

// ENDPOINT: Onde o formulário de importação envia os dados
app.post('/import-leads', async (req, res) => {
    const leadsToImport = req.body;
    if (!Array.isArray(leadsToImport) || leadsToImport.length === 0) {
        return res.status(400).send('Dados de importação ausentes ou formato inválido.');
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
            if (!lead || typeof lead !== 'object' || !lead.facebook_lead_id) continue;
            await pool.query(queryText, [
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

// ENDPOINT DO WEBHOOK: Onde o CRM envia o evento
app.post('/webhook', async (req, res) => {
    try {
        const leadData = req.body;
        const crmEventName = leadData.tag ? leadData.tag.name : null;
        if (!crmEventName) {
            return res.status(200).send('Webhook recebido, mas sem nome de evento.');
        }
        const facebookEventName = mapCRMEventToFacebookEvent(crmEventName);
        if (!leadData || !leadData.lead) {
            return res.status(400).send('Dados do lead ausentes no webhook.');
        }
        const leadEmail = leadData.lead.email ? leadData.lead.email.toLowerCase() : null;
        const leadPhone = leadData.lead.phone ? leadData.lead.phone.replace(/\D/g, '') : null;
        if (!leadEmail && !leadPhone) {
            return res.status(400).send('E-mail ou telefone do lead ausentes no webhook.');
        }
        const result = await pool.query(
            'SELECT facebook_lead_id, first_name, last_name, dob, city, estado, zip_code FROM leads WHERE email = $1 OR phone = $2',
            [leadEmail, leadPhone]
        );
        if (result.rows.length === 0) {
            console.log(`Lead com email/telefone ${leadEmail}/${leadPhone} não encontrado no banco.`);
            return res.status(200).send('ID do Facebook não encontrado.');
        }
        const dbRow = result.rows[0];
        // ... Lógica para enviar o evento ao Facebook ...
        const PIXEL_ID = process.env.PIXEL_ID;
        const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
        const userData = {};
        if (leadEmail) userData.em = [crypto.createHash('sha256').update(leadEmail).digest('hex')];
        if (leadPhone) userData.ph = [crypto.createHash('sha256').update(leadPhone).digest('hex')];
        if (dbRow.first_name) userData.fn = [crypto.createHash('sha256').update(dbRow.first_name.toLowerCase()).digest('hex')];
        if (dbRow.last_name) userData.ln = [crypto.createHash('sha256').update(dbRow.last_name.toLowerCase()).digest('hex')];
        if (dbRow.dob) userData.db = [crypto.createHash('sha256').update(String(dbRow.dob).replace(/\D/g, '')).
