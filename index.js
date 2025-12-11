// ============================================================================
// SERVIDOR DE INTELIGÊNCIA DE LEADS (HÍBRIDO: SITE + NATIVO) - VERSÃO FINAL V7
// ============================================================================

const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');

const app = express();

// Habilita CORS para aceitar dados vindos do seu site (smartcredbrasil.com.br)
app.use(cors());

// Define a porta (O Render usa a variável de ambiente PORT)
const port = process.env.PORT || 10000;

// Aumenta o limite de dados para aceitar importações grandes
app.use(express.json({ limit: '50mb' }));

// Função de Espera (Sleep) para a lógica de "Retry"
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// 1. CONFIGURAÇÕES E BANCO DE DADOS
// ============================================================================

// Função para mapear o evento do CRM para o evento do Facebook (SEU MAPEAMENTO ORIGINAL)
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

// Conexão com o PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Inicializa a Tabela se não existir
const initializeDatabase = async () => {
    const client = await pool.connect();
    try {
        console.log('🔄 Verificando estrutura do Banco de Dados...');
        
        // Cria a tabela se não existir
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

        // Garante que todas as colunas existam (Auto-Correção)
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
                console.log(`➕ Coluna criada: ${columnName}`);
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
// 2. ROTA: CAPTURA DO SITE (SCRIPT V7)
// Recebe dados parciais (blur) ou completos (submit) e salva/atualiza no banco.
// ============================================================================
app.post('/capture-site-data', async (req, res) => {
    const client = await pool.connect();
    try {
        const data = req.body;

        // Log para monitoramento no Render
        console.log(' ');
        console.log('🚀 [SITE] DADO RECEBIDO (V7)');
        console.log(`   🆔 ID Sessão: ${data.custom_id}`);
        console.log(`   👤 ${data.name || '-'} | 📧 ${data.email || '-'} | 📱 ${data.phone || '-'}`);

        // Define o ID: Se veio do script, usa ele. Se não, gera um novo.
        const webLeadId = data.custom_id || `WEB-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const createdTime = Math.floor(Date.now() / 1000);
        
        // Limpeza básica
        const email = data.email ? data.email.toLowerCase().trim() : null;
        const phone = data.phone ? data.phone.replace(/\D/g, '') : null;
        
        // Separa Nome e Sobrenome
        let firstName = data.name || '';
        let lastName = '';
        if (firstName.includes(' ')) {
            const parts = firstName.split(' ');
            firstName = parts[0];
            lastName = parts.slice(1).join(' ');
        }

        // QUERY INTELIGENTE (UPSERT com COALESCE)
        // Se o lead já existe (mesmo ID), atualiza SÓ os campos novos.
        // Se o campo novo for nulo, MANTÉM o antigo (não apaga dados).
        const queryText = `
            INSERT INTO leads (facebook_lead_id, created_time, email, phone, first_name, last_name, fbc, fbp, platform, is_organic, form_name)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'site_smartcred', false, 'Formulario Site')
            ON CONFLICT (facebook_lead_id) DO UPDATE SET
                email = COALESCE(EXCLUDED.email, leads.email),
                phone = COALESCE(EXCLUDED.phone, leads.phone),
                first_name = COALESCE(EXCLUDED.first_name, leads.first_name),
                last_name = COALESCE(EXCLUDED.last_name, leads.last_name),
                fbc = COALESCE(EXCLUDED.fbc, leads.fbc),
                fbp = COALESCE(EXCLUDED.fbp, leads.fbp);
        `;

        await client.query(queryText, [
            webLeadId, createdTime, email, phone, firstName, lastName, data.fbc, data.fbp
        ]);

        console.log('💾 [DB] Dados atualizados com sucesso!');
        res.status(200).json({ success: true });

    } catch (error) {
        console.error('❌ [ERRO] Falha ao salvar lead do site:', error);
        res.status(500).json({ success: false });
    } finally {
        client.release();
    }
});

// ============================================================================
// 3. ROTA: WEBHOOK (CRM -> FACEBOOK API)
// Recebe a notificação do CRM, busca no banco e envia para o Facebook.
// ============================================================================
app.post('/webhook', async (req, res) => {
    console.log("--- 🔔 Webhook Recebido ---");
    try {
        const leadData = req.body;
        
        // Validações básicas
        const crmEventName = leadData.tag ? leadData.tag.name : null;
        if (!crmEventName) return res.status(200).send('Ignorado: Sem tag de evento.');

        const facebookEventName = mapCRMEventToFacebookEvent(crmEventName);
        if (!leadData.lead) return res.status(400).send('Dados do lead ausentes.');
        
        // Pega Email e Telefone do CRM
        const leadEmail = leadData.lead.email ? leadData.lead.email.toLowerCase().trim() : null;
        let leadPhone = leadData.lead.phone ? leadData.lead.phone.replace(/\D/g, '') : null;
        
        if (!leadEmail && !leadPhone) return res.status(400).send('Email/Fone ausentes.');

        // TRATAMENTO DE TELEFONE (Remove DDI 55 se existir para melhorar a busca)
        let searchPhone = leadPhone;
        if (searchPhone && searchPhone.startsWith('55') && searchPhone.length > 11) {
            searchPhone = searchPhone.substring(2); // Remove o 55
        }

        console.log(`🔎 Buscando no Banco: Email="${leadEmail}" OU Phone(final)="${searchPhone}"`);

        // LÓGICA DE RETRY (Tenta 3 vezes esperar o Script do Site chegar)
        let dbRow;
        let result;
        let attempts = 0;
        
        // Query que busca email exato OU telefone que termine com os dígitos do CRM
        const searchQuery = `
            SELECT * FROM leads 
            WHERE email = $1 
            OR phone LIKE '%' || $2 
            LIMIT 1
        `;

        while (attempts < 3) {
            attempts++;
            result = await pool.query(searchQuery, [leadEmail, searchPhone]);

            if (result.rows.length > 0) {
                dbRow = result.rows[0];
                console.log(`✅ Lead ENCONTRADO na tentativa ${attempts}!`);
                break; 
            } else {
                if (attempts < 3) {
                    console.log(`⏳ Tentativa ${attempts}: Lead não encontrado. Aguardando 3 segundos...`);
                    await sleep(3000); // Pausa a execução
                }
            }
        }

        if (!dbRow) {
            console.log('❌ Lead não encontrado no banco após 3 tentativas.');
            // Opcional: Se quiser enviar mesmo sem FBC/FBP, você pode montar um objeto userData básico aqui.
            // Por enquanto, abortamos para não sujar o pixel.
            return res.status(200).send('Lead não encontrado no DB.');
        }

        // PREPARAÇÃO PARA API DO FACEBOOK
        const PIXEL_ID = process.env.PIXEL_ID;
        const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
        
        if (!PIXEL_ID || !FB_ACCESS_TOKEN) return res.status(500).send('Erro config ENV.');

        const userData = {};
        
        // 1. Criptografia SHA256 (Exigência do Facebook)
        if (dbRow.email) userData.em = [crypto.createHash('sha256').update(dbRow.email).digest('hex')];
        if (dbRow.phone) userData.ph = [crypto.createHash('sha256').update(dbRow.phone).digest('hex')];
        if (dbRow.first_name) userData.fn = [crypto.createHash('sha256').update(dbRow.first_name.toLowerCase()).digest('hex')];
        if (dbRow.last_name) userData.ln = [crypto.createHash('sha256').update(dbRow.last_name.toLowerCase()).digest('hex')];
        if (dbRow.city) userData.ct = [crypto.createHash('sha256').update(dbRow.city.toLowerCase()).digest('hex')];
        if (dbRow.estado) userData.st = [crypto.createHash('sha256').update(dbRow.estado.toLowerCase()).digest('hex')];
        if (dbRow.zip_code) userData.zp = [crypto.createHash('sha256').update(String(dbRow.zip_code).replace(/\D/g, '')).digest('hex')];

        // 2. Cookies (Ouro do Script do Site)
        if (dbRow.fbc) userData.fbc = dbRow.fbc;
        if (dbRow.fbp) userData.fbp = dbRow.fbp;
        
        // 3. ID do Lead (Só manda se for nativo do FB, se for 'WEB-' ignora)
        if (dbRow.facebook_lead_id && !dbRow.facebook_lead_id.startsWith('WEB-')) {
            userData.lead_id = dbRow.facebook_lead_id;
        }

        // Monta o Pacote
        const eventTime = Math.floor(Date.now() / 1000);
        const eventData = { 
            event_name: facebookEventName, 
            event_time: eventTime, 
            action_source: 'website', 
            user_data: userData,
            custom_data: { 
                event_source: 'crm',
                lead_event_source: 'Greenn Sales',
                campaign_name: dbRow.campaign_name,
                form_name: dbRow.form_name,
                lead_status: dbRow.lead_status,
                currency: 'BRL',
                value: 0
            }
        };

        const facebookAPIUrl = `https://graph.facebook.com/v24.0/${PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`;
        
        console.log(`📤 Enviando '${facebookEventName}' para Facebook API...`);
        // console.log('Payload:', JSON.stringify(eventData, null, 2)); // Debug

        // DISPARO REAL
        await axios.post(facebookAPIUrl, { data: [eventData] });

        console.log(`✅ SUCESSO! Evento enviado para o Facebook.`);
        res.status(200).send('Evento enviado!');

    } catch (error) {
        console.error('❌ Erro no Webhook:', error.response ? JSON.stringify(error.response.data) : error.message);
        res.status(500).send('Erro interno.');
    }
});

// ============================================================================
// 4. ROTAS DE IMPORTAÇÃO (LEGADO/NATIVO)
// ============================================================================
app.get('/importar', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><title>Importar</title><style>body{font-family:sans-serif;text-align:center;padding:50px}textarea{width:100%;max-width:800px;height:300px}button{padding:10px 20px;margin-top:10px}</style></head><body><h1>Importar Leads (JSON)</h1><textarea id="d"></textarea><br><button onclick="i()">Enviar</button><p id="m"></p><script>async function i(){const d=document.getElementById('d').value;try{const r=await fetch('/import-leads',{method:'POST',headers:{'Content-Type':'application/json'},body:d});document.getElementById('m').innerText=await r.text()}catch(e){document.getElementById('m').innerText='Erro'}}</script></body></html>`);
});

app.post('/import-leads', async (req, res) => {
    const leads = req.body;
    if (!Array.isArray(leads)) return res.status(400).send('Formato inválido');
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const q = `INSERT INTO leads (facebook_lead_id, created_time, email, phone, first_name, last_name, ad_id, ad_name, campaign_name, form_name, platform, is_organic) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (facebook_lead_id) DO NOTHING`;
        
        for (const l of leads) {
            if(!l.id) continue;
            await client.query(q, [
                l.id, l.created_time ? Math.floor(new Date(l.created_time).getTime()/1000) : null,
                l.email, (l.phone_number||'').replace(/\D/g,''), l.nome, l.sobrenome,
                l.ad_id, l.ad_name, l.campaign_name, l.form_name, l.platform, l.is_organic
            ]);
        }
        await client.query('COMMIT');
        res.send('Importação concluída.');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(e);
        res.status(500).send('Erro');
    } finally {
        client.release();
    }
});

// ============================================================================
// 5. INICIALIZAÇÃO DO SERVIDOR
// ============================================================================
app.get('/', (req, res) => res.send('🟢 Servidor SmartCred (V7) Online!'));

const startServer = async () => {
    try {
        await initializeDatabase();
        app.listen(port, () => console.log(`🚀 Servidor rodando na porta ${port}`));
    } catch (error) {
        console.error("❌ Falha fatal ao iniciar:", error);
    }
};

startServer();
