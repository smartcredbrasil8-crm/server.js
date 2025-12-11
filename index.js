// Importa as bibliotecas necessárias para o projeto
const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');

// Cria uma instância do Express
const app = express();

// Habilita CORS para aceitar requisições do seu site
app.use(cors());

const port = process.env.PORT || 10000;

// Middleware para entender dados JSON
app.use(express.json({ limit: '50mb' }));

// -------------------------------------------------------------------------
// 1. CONFIGURAÇÕES DO BANCO DE DADOS E FUNÇÕES AUXILIARES
// -------------------------------------------------------------------------

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
    ssl: { rejectUnauthorized: false }
});

// Função para inicializar o banco de dados
const initializeDatabase = async () => {
    const client = await pool.connect();
    try {
        console.log('Conexão com o pool do banco de dados estabelecida.');
        
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS leads (
                facebook_lead_id TEXT PRIMARY KEY,
                created_time BIGINT,
                email TEXT,
                phone TEXT,
                first_name TEXT,
                last_name TEXT,
                dob TEXT,
                city TEXT,
                estado TEXT,
                zip_code TEXT,
                ad_id TEXT,
                ad_name TEXT,
                adset_id TEXT,
                adset_name TEXT,
                campaign_id TEXT,
                campaign_name TEXT,
                form_id TEXT,
                form_name TEXT,
                platform TEXT,
                is_organic BOOLEAN,
                lead_status TEXT,
                fbc TEXT, 
                fbp TEXT
            );
        `;
        await client.query(createTableQuery);
        console.log('Tabela "leads" principal verificada/criada com sucesso.');

        // Adiciona colunas que podem faltar (incluindo fbc e fbp)
        const allColumns = {
            'created_time': 'BIGINT', 'email': 'TEXT', 'phone': 'TEXT', 'first_name': 'TEXT', 'last_name': 'TEXT',
            'dob': 'TEXT', 'city': 'TEXT', 'estado': 'TEXT', 'zip_code': 'TEXT', 'ad_id': 'TEXT', 'ad_name': 'TEXT',
            'adset_id': 'TEXT', 'adset_name': 'TEXT', 'campaign_id': 'TEXT', 'campaign_name': 'TEXT', 'form_id': 'TEXT',
            'form_name': 'TEXT', 'platform': 'TEXT', 'is_organic': 'BOOLEAN', 'lead_status': 'TEXT',
            'fbc': 'TEXT', 'fbp': 'TEXT'
        };

        for (const [columnName, columnType] of Object.entries(allColumns)) {
            const check = await client.query("SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name=$1", [columnName]);
            if (check.rows.length === 0) {
                await client.query(`ALTER TABLE leads ADD COLUMN ${columnName} ${columnType};`);
                console.log(`Coluna de manutenção "${columnName}" adicionada.`);
            }
        }
        
    } catch (err) {
        console.error('Erro ao inicializar o banco de dados:', err.message);
        throw err;
    } finally {
        client.release();
    }
};

// -------------------------------------------------------------------------
// 2. ROTA NOVA - CAPTURA DO SITE E SALVA NO BANCO
// -------------------------------------------------------------------------

app.post('/capture-site-data', async (req, res) => {
    const client = await pool.connect();
    try {
        const data = req.body;

        // Logs visuais
        console.log(' ');
        console.log('🚀 LEAD VINDO DO SITE (SCRIPT V5)');
        console.log(`👤 Nome: ${data.name} | 📧 Email: ${data.email} | 📱 Fone: ${data.phone}`);
        console.log(`🍪 FBC: ${data.fbc} | FBP: ${data.fbp}`);

        // Tratamento de dados para salvar
        // Geramos um ID falso para o site pois ele não tem ID do Facebook
        const webLeadId = `WEB-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const createdTime = Math.floor(Date.now() / 1000);
        const email = data.email ? data.email.toLowerCase() : null;
        const phone = data.phone ? data.phone.replace(/\D/g, '') : null;
        
        // Separa Nome e Sobrenome (se possível)
        let firstName = data.name || '';
        let lastName = '';
        if (firstName.includes(' ')) {
            const parts = firstName.split(' ');
            firstName = parts[0];
            lastName = parts.slice(1).join(' ');
        }

        // Query de Inserção (Upsert)
        const queryText = `
            INSERT INTO leads (facebook_lead_id, created_time, email, phone, first_name, last_name, fbc, fbp, platform, is_organic, form_name)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'site_smartcred', false, 'Formulario Site')
            ON CONFLICT (facebook_lead_id) DO UPDATE SET
                email = EXCLUDED.email,
                phone = EXCLUDED.phone,
                fbc = EXCLUDED.fbc,
                fbp = EXCLUDED.fbp;
        `;

        await client.query(queryText, [
            webLeadId, createdTime, email, phone, firstName, lastName, data.fbc, data.fbp
        ]);

        console.log('✅ Lead do site SALVO no banco de dados com sucesso!');
        res.status(200).json({ success: true, message: "Lead salvo no banco!" });

    } catch (error) {
        console.error('❌ ERRO AO SALVAR LEAD DO SITE:', error);
        res.status(500).json({ success: false, error: "Erro interno no servidor" });
    } finally {
        client.release();
    }
});

// -------------------------------------------------------------------------
// 3. ROTA DE IMPORTAÇÃO (GET)
// -------------------------------------------------------------------------
app.get('/importar', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Importar Leads</title>
            <style> body { font-family: sans-serif; text-align: center; margin-top: 50px; } textarea { width: 90%; max-width: 1200px; height: 400px; margin-top: 20px; font-family: monospace; } button { padding: 10px 20px; font-size: 16px; cursor: pointer; } </style>
        </head>
        <body>
            <h1>Importar Leads para o Banco de Dados</h1>
            <p>Cole seus dados JSON aqui. Use os cabeçalhos da sua planilha (ex: id, created_time, email, etc.).</p>
            <textarea id="leads-data" placeholder='[{"id": "123...", "created_time": "2025-10-20T10:30:00-0300", "email": "teste@email.com", ...}]'></textarea><br>
            <button onclick="importLeads()">Importar Leads</button>
            <p id="status-message" style="margin-top: 20px; font-weight: bold;"></p>
            <script>
                async function importLeads() {
                    const data = document.getElementById('leads-data').value;
                    const statusMessage = document.getElementById('status-message');
                    try {
                        const response = await fetch('/import-leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: data });
                        const result = await response.text();
                        statusMessage.textContent = result;
                        statusMessage.style.color = 'green';
                    } catch (error) {
                        statusMessage.textContent = 'Erro na importação: ' + error.message;
                        statusMessage.style.color = 'red';
                    }
                }
            </script>
        </body>
        </html>
    `);
});

// -------------------------------------------------------------------------
// 4. ROTA DE IMPORTAÇÃO (POST)
// -------------------------------------------------------------------------
app.post('/import-leads', async (req, res) => {
    const leadsToImport = req.body;
    if (!Array.isArray(leadsToImport)) { return res.status(400).send('Formato inválido.'); }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const queryText = `
            INSERT INTO leads (facebook_lead_id, created_time, email, phone, first_name, last_name, dob, city, estado, zip_code, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, form_id, form_name, platform, is_organic, lead_status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
            ON CONFLICT (facebook_lead_id) DO UPDATE SET
                created_time = EXCLUDED.created_time, email = EXCLUDED.email, phone = EXCLUDED.phone,
                first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, dob = EXCLUDED.dob,
                city = EXCLUDED.city, estado = EXCLUDED.estado, zip_code = EXCLUDED.zip_code,
                ad_id = EXCLUDED.ad_id, ad_name = EXCLUDED.ad_name, adset_id = EXCLUDED.adset_id,
                adset_name = EXCLUDED.adset_name, campaign_id = EXCLUDED.campaign_id, campaign_name = EXCLUDED.campaign_name,
                form_id = EXCLUDED.form_id, form_name = EXCLUDED.form_name, platform = EXCLUDED.platform,
                is_organic = EXCLUDED.is_organic, lead_status = EXCLUDED.lead_status;
        `;
        for (const lead of leadsToImport) {
            if (!lead || !lead.id) continue;
            const createdTimestamp = lead.created_time ? Math.floor(new Date(lead.created_time).getTime() / 1000) : null;
            await client.query(queryText, [
                lead.id, createdTimestamp, lead.email, (lead.phone_number || '').replace(/\D/g, ''),
                lead.nome, lead.sobrenome, lead.data_de_nascimento, lead.city,
                lead.state, lead.cep, lead.ad_id, lead.ad_name, lead.adset_id,
                lead.adset_name, lead.campaign_id, lead.campaign_name, lead.form_id,
                lead.form_name, lead.platform, lead.is_organic, lead.lead_status
            ]);
        }
        await client.query('COMMIT');
        res.status(201).send('Leads importados com sucesso!');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao importar leads:', error.message);
        res.status(500).send('Erro interno do servidor.');
    } finally {
        client.release();
    }
});

// -------------------------------------------------------------------------
// 5. ENDPOINT DO WEBHOOK (CRM -> FACEBOOK API)
// -------------------------------------------------------------------------
app.post('/webhook', async (req, res) => {
    console.log("--- Webhook recebido ---");
    try {
        const leadData = req.body;
        const crmEventName = leadData.tag ? leadData.tag.name : null;
        if (!crmEventName) { return res.status(200).send('Webhook recebido, mas sem nome de evento.'); }

        const facebookEventName = mapCRMEventToFacebookEvent(crmEventName);
        if (!leadData.lead) { return res.status(400).send('Dados do lead ausentes.'); }
        
        const leadEmail = leadData.lead.email ? leadData.lead.email.toLowerCase() : null;
        const leadPhone = leadData.lead.phone ? leadData.lead.phone.replace(/\D/g, '') : null;
        if (!leadEmail && !leadPhone) { return res.status(400).send('E-mail ou telefone ausentes.'); }

        // BUSCA O LEAD NO BANCO (AGORA VAI ENCONTRAR O LEAD DO SITE!)
        const result = await pool.query('SELECT * FROM leads WHERE email = $1 OR phone = $2', [leadEmail, leadPhone]);

        if (result.rows.length === 0) {
            console.log('Lead não encontrado no banco de dados.');
            return res.status(200).send('ID do Facebook não encontrado.');
        }

        const dbRow = result.rows[0];
        const PIXEL_ID = process.env.PIXEL_ID;
        const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
        
        if (!PIXEL_ID || !FB_ACCESS_TOKEN) {
            console.error('ERRO: Variáveis de ambiente não configuradas!');
            return res.status(500).send('Erro de configuração no servidor.');
        }

        // Prepara os dados do usuário (Hash SHA256)
        const userData = {};
        if (dbRow.email) userData.em = [crypto.createHash('sha256').update(dbRow.email).digest('hex')];
        if (dbRow.phone) userData.ph = [crypto.createHash('sha256').update(dbRow.phone).digest('hex')];
        if (dbRow.first_name) userData.fn = [crypto.createHash('sha256').update(dbRow.first_name.toLowerCase()).digest('hex')];
        if (dbRow.last_name) userData.ln = [crypto.createHash('sha256').update(dbRow.last_name.toLowerCase()).digest('hex')];
        if (dbRow.city) userData.ct = [crypto.createHash('sha256').update(dbRow.city.toLowerCase()).digest('hex')];
        if (dbRow.estado) userData.st = [crypto.createHash('sha256').update(dbRow.estado.toLowerCase()).digest('hex')];
        
        // *** AQUI ESTÁ O SEGREDO: ENVIA FBC E FBP SE TIVER ***
        if (dbRow.fbc) userData.fbc = dbRow.fbc;
        if (dbRow.fbp) userData.fbp = dbRow.fbp;
        
        // Se for lead do Facebook, manda o ID do Lead. Se for do site, não manda esse campo.
        if (dbRow.facebook_lead_id && !dbRow.facebook_lead_id.startsWith('WEB-')) {
            userData.lead_id = dbRow.facebook_lead_id;
        }

        const eventTime = Math.floor(Date.now() / 1000); // Usa o tempo atual da conversão no CRM

        const eventData = { 
            event_name: facebookEventName, 
            event_time: eventTime, 
            action_source: 'website', // Mudamos para website pois veio do site/crm
            user_data: userData,
            custom_data: { 
                event_source: 'crm',
                lead_event_source: 'Greenn Sales',
                campaign_name: dbRow.campaign_name,
                form_name: dbRow.form_name,
                lead_status: dbRow.lead_status
            }
        };
        const facebookAPIUrl = `https://graph.facebook.com/v24.0/${PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`;
        
        console.log(`Enviando evento '${facebookEventName}' para a API do Facebook...`);
        // await axios.post(facebookAPIUrl, { data: [eventData] }); // Descomente para enviar de verdade

        console.log('PAYLOAD FACEBOOK:', JSON.stringify(eventData, null, 2));
        console.log(`Evento '${facebookEventName}' processado para: ${dbRow.email}`);
        
        // Envio real (Se quiser ativar, remova o comentário do axios acima e desta linha abaixo)
        await axios.post(facebookAPIUrl, { data: [eventData] });

        res.status(200).send('Evento de conversão enviado com sucesso!');

    } catch (error) {
        console.error('Erro ao processar o webhook:', error.response ? JSON.stringify(error.response.data) : error.message);
        res.status(500).send('Erro interno do servidor.');
    }
});

// ROTA DE TESTE E HEALTH CHECK
app.get('/', (req, res) => {
  console.log("A rota principal (GET /) foi acessada com sucesso!");
  res.status(200).send("🟢 Servidor Espião V5 + Banco de Dados + Webhook ONLINE!");
});

// Função para iniciar o servidor APÓS a inicialização do banco de dados
const startServer = async () => {
    try {
        await initializeDatabase();
        app.listen(port, () => {
            console.log(`Servidor rodando na porta ${port} e pronto para receber requisições.`);
        });
    } catch (error) {
        console.error("Falha crítica ao iniciar o servidor. O banco de dados pode estar inacessível.", error);
        process.exit(1);
    }
};

// Inicia todo o processo
startServer();
