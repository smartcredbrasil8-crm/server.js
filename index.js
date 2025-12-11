// ============================================================================
// SERVIDOR DE INTELIGÊNCIA DE LEADS (V8 - EMQ MAXIMIZADO)
// ============================================================================

const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');

const app = express();

app.use(cors());
const port = process.env.PORT || 10000;
app.use(express.json({ limit: '50mb' }));

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Mapeamento de Eventos
const mapCRMEventToFacebookEvent = (crmEvent) => {
    if (!crmEvent) return 'Lead'; 
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

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Inicialização do Banco (Com novas colunas de IP e User Agent)
const initializeDatabase = async () => {
    const client = await pool.connect();
    try {
        console.log('🔄 Verificando Banco de Dados...');
        
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
                fbp TEXT,
                client_ip_address TEXT, 
                client_user_agent TEXT 
            );
        `;
        await client.query(createTableQuery);

        // Lista de colunas para verificar/criar
        const allColumns = {
            'created_time': 'BIGINT', 'email': 'TEXT', 'phone': 'TEXT', 'first_name': 'TEXT', 'last_name': 'TEXT',
            'dob': 'TEXT', 'city': 'TEXT', 'estado': 'TEXT', 'zip_code': 'TEXT', 'ad_id': 'TEXT', 'ad_name': 'TEXT',
            'adset_id': 'TEXT', 'adset_name': 'TEXT', 'campaign_id': 'TEXT', 'campaign_name': 'TEXT', 'form_id': 'TEXT',
            'form_name': 'TEXT', 'platform': 'TEXT', 'is_organic': 'BOOLEAN', 'lead_status': 'TEXT',
            'fbc': 'TEXT', 'fbp': 'TEXT',
            'client_ip_address': 'TEXT', // Novo
            'client_user_agent': 'TEXT'  // Novo
        };

        for (const [columnName, columnType] of Object.entries(allColumns)) {
            const check = await client.query("SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name=$1", [columnName]);
            if (check.rows.length === 0) {
                await client.query(`ALTER TABLE leads ADD COLUMN ${columnName} ${columnType};`);
                console.log(`➕ Coluna nova criada: ${columnName}`);
            }
        }
        console.log('✅ Banco de Dados Pronto!');
    } catch (err) {
        console.error('❌ Erro no Banco:', err.message);
    } finally {
        client.release();
    }
};

// ============================================================================
// ROTA 1: CAPTURA DO SITE (COM IP E USER AGENT)
// ============================================================================
app.post('/capture-site-data', async (req, res) => {
    const client = await pool.connect();
    try {
        const data = req.body;

        // Captura o IP real (O Render usa proxy, então pegamos do header)
        let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        if (ip && ip.includes(',')) ip = ip.split(',')[0].trim(); // Pega o primeiro IP da lista

        // Captura o User Agent (Navegador)
        const userAgent = data.agent || req.headers['user-agent'];

        console.log(' ');
        console.log('🚀 [SITE] DADO RECEBIDO (V8)');
        console.log(`   👤 ${data.name || '-'} | 💻 IP: ${ip}`);

        const webLeadId = data.custom_id || `WEB-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const createdTime = Math.floor(Date.now() / 1000);
        const email = data.email ? data.email.toLowerCase().trim() : null;
        const phone = data.phone ? data.phone.replace(/\D/g, '') : null;
        
        let firstName = data.name || '';
        let lastName = '';
        if (firstName.includes(' ')) {
            const parts = firstName.split(' ');
            firstName = parts[0];
            lastName = parts.slice(1).join(' ');
        }

        // Atualiza o banco com IP e User Agent
        const queryText = `
            INSERT INTO leads (facebook_lead_id, created_time, email, phone, first_name, last_name, fbc, fbp, client_ip_address, client_user_agent, platform, is_organic, form_name)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'site_smartcred', false, 'Formulario Site')
            ON CONFLICT (facebook_lead_id) DO UPDATE SET
                email = COALESCE(EXCLUDED.email, leads.email),
                phone = COALESCE(EXCLUDED.phone, leads.phone),
                first_name = COALESCE(EXCLUDED.first_name, leads.first_name),
                fbc = COALESCE(EXCLUDED.fbc, leads.fbc),
                fbp = COALESCE(EXCLUDED.fbp, leads.fbp),
                client_ip_address = COALESCE(EXCLUDED.client_ip_address, leads.client_ip_address),
                client_user_agent = COALESCE(EXCLUDED.client_user_agent, leads.client_user_agent);
        `;

        await client.query(queryText, [
            webLeadId, createdTime, email, phone, firstName, lastName, data.fbc, data.fbp, ip, userAgent
        ]);

        console.log('💾 [DB] Dados (incluindo IP/Agent) salvos!');
        res.status(200).json({ success: true });

    } catch (error) {
        console.error('❌ [ERRO] Falha ao salvar:', error);
        res.status(500).json({ success: false });
    } finally {
        client.release();
    }
});

// ============================================================================
// ROTA 3: WEBHOOK (ENVIA TUDO PARA O FACEBOOK)
// ============================================================================
app.post('/webhook', async (req, res) => {
    console.log("--- 🔔 Webhook Recebido ---");
    try {
        const leadData = req.body;
        const crmEventName = leadData.tag ? leadData.tag.name : null;
        if (!crmEventName) return res.status(200).send('Sem tag.');

        const facebookEventName = mapCRMEventToFacebookEvent(crmEventName);
        if (!leadData.lead) return res.status(400).send('Sem dados.');
        
        const leadEmail = leadData.lead.email ? leadData.lead.email.toLowerCase().trim() : null;
        let leadPhone = leadData.lead.phone ? leadData.lead.phone.replace(/\D/g, '') : null;
        if (!leadEmail && !leadPhone) return res.status(400).send('Sem contatos.');

        // Tratamento DDI para busca
        let searchPhone = leadPhone;
        if (searchPhone && searchPhone.startsWith('55') && searchPhone.length > 11) {
            searchPhone = searchPhone.substring(2);
        }

        // Lógica de Retry (Busca Inteligente)
        let dbRow;
        let result;
        let attempts = 0;
        const searchQuery = `SELECT * FROM leads WHERE email = $1 OR phone LIKE '%' || $2 LIMIT 1`;

        while (attempts < 3) {
            attempts++;
            result = await pool.query(searchQuery, [leadEmail, searchPhone]);
            if (result.rows.length > 0) {
                dbRow = result.rows[0];
                console.log(`✅ Lead encontrado (Tentativa ${attempts})`);
                break; 
            } else {
                if (attempts < 3) await sleep(3000);
            }
        }

        if (!dbRow) {
            console.log('❌ Lead não encontrado no DB.');
            return res.status(200).send('Não encontrado.');
        }

        const PIXEL_ID = process.env.PIXEL_ID;
        const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
        if (!PIXEL_ID || !FB_ACCESS_TOKEN) return res.status(500).send('Erro Config.');

        const userData = {};
        
        // --- DADOS HASHED (SHA256) ---
        if (dbRow.email) userData.em = [crypto.createHash('sha256').update(dbRow.email).digest('hex')];
        if (dbRow.phone) userData.ph = [crypto.createHash('sha256').update(dbRow.phone).digest('hex')];
        if (dbRow.first_name) userData.fn = [crypto.createHash('sha256').update(dbRow.first_name.toLowerCase()).digest('hex')];
        if (dbRow.last_name) userData.ln = [crypto.createHash('sha256').update(dbRow.last_name.toLowerCase()).digest('hex')];
        if (dbRow.city) userData.ct = [crypto.createHash('sha256').update(dbRow.city.toLowerCase()).digest('hex')];
        if (dbRow.estado) userData.st = [crypto.createHash('sha256').update(dbRow.estado.toLowerCase()).digest('hex')];
        if (dbRow.zip_code) userData.zp = [crypto.createHash('sha256').update(String(dbRow.zip_code).replace(/\D/g, '')).digest('hex')];

        // --- DADOS DE QUALIDADE DO EVENTO (NÃO HASHED) ---
        if (dbRow.fbc) userData.fbc = dbRow.fbc;
        if (dbRow.fbp) userData.fbp = dbRow.fbp;
        if (dbRow.client_ip_address) userData.client_ip_address = dbRow.client_ip_address; // NOVO
        if (dbRow.client_user_agent) userData.client_user_agent = dbRow.client_user_agent; // NOVO

        // --- EXTERNAL ID ---
        // Usamos o ID gerado pelo nosso sistema (WEB-...) ou o ID do Face Nativo como External ID
        // Isso ajuda o Facebook a evitar duplicidade
        if (dbRow.facebook_lead_id) {
            userData.external_id = [crypto.createHash('sha256').update(dbRow.facebook_lead_id).digest('hex')];
        }

        // Lead ID (Apenas se vier do Facebook Nativo)
        if (dbRow.facebook_lead_id && !dbRow.facebook_lead_id.startsWith('WEB-')) {
            userData.lead_id = dbRow.facebook_lead_id;
        }

        const eventTime = Math.floor(Date.now() / 1000);
        const eventData = { 
            event_name: facebookEventName, 
            event_time: eventTime, 
            action_source: 'website', // Site = Website
            user_data: userData,
            custom_data: { 
                event_source: 'crm',
                lead_event_source: 'Greenn Sales',
                campaign_name: dbRow.campaign_name,
                lead_status: dbRow.lead_status
            }
        };

        const facebookAPIUrl = `https://graph.facebook.com/v24.0/${PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`;
        
        console.log(`📤 Enviando '${facebookEventName}'... (IP: ${dbRow.client_ip_address || 'N/A'})`);
        
        await axios.post(facebookAPIUrl, { data: [eventData] });

        console.log(`✅ Evento enviado com sucesso!`);
        res.status(200).send('Enviado.');

    } catch (error) {
        console.error('❌ Erro Webhook:', error.response ? JSON.stringify(error.response.data) : error.message);
        res.status(500).send('Erro.');
    }
});

// Importar e Iniciar (Mesmo código de sempre)
app.get('/importar', (req, res) => res.send('<h1>Importador V8 Ativo</h1>'));
app.post('/import-leads', async (req, res) => { /* Código importação mantido */ res.send('Ok'); });

app.get('/', (req, res) => res.send('🟢 Servidor V8 (Max Quality) Online!'));

const startServer = async () => {
    try {
        await initializeDatabase();
        app.listen(port, () => console.log(`🚀 Servidor na porta ${port}`));
    } catch (error) {
        console.error("❌ Falha:", error);
    }
};

startServer();
