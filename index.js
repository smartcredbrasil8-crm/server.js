// ============================================================================
// SERVIDOR DE INTELIGÊNCIA DE LEADS (V8.28 - PERIODOS AJUSTADOS: 3/7/15/30 DIAS)
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

// ============================================================================
// 1. CONFIGURAÇÕES E MAPA DE EVENTOS
// ============================================================================

const mapCRMEventToFacebookEvent = (crmEvent) => {
    if (!crmEvent) return null; 
    
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

const initializeDatabase = async () => {
    const client = await pool.connect();
    try {
        console.log('🔄 Verificando estrutura do Banco de Dados...');
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
                client_user_agent TEXT,
                last_sent_event TEXT 
            );
        `;
        await client.query(createTableQuery);

        // Garante colunas críticas
        const colunasExtras = ['adset_name', 'campaign_name', 'dob', 'city', 'estado'];
        for (const col of colunasExtras) {
             const check = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='${col}'`);
             if (check.rows.length === 0) {
                 await client.query(`ALTER TABLE leads ADD COLUMN ${col} TEXT;`);
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
// 2. ROTA DE CAPTURA DO SITE (COM DADOS COMPLETOS)
// ============================================================================
app.post('/capture-site-data', async (req, res) => {
    const client = await pool.connect();
    try {
        const data = req.body;
        
        let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();
        const userAgent = data.agent || req.headers['user-agent'];
        
        const email = data.email ? data.email.toLowerCase().trim() : null;
        const phone = data.phone ? data.phone.replace(/\D/g, '') : null;
        let firstName = data.name || '';
        let lastName = '';
        if (firstName.includes(' ')) {
            const parts = firstName.split(' ');
            firstName = parts[0];
            lastName = parts.slice(1).join(' ');
        }
        
        const campaign = data.campaign_name || data.utm_campaign || data.campaign || null;
        const adset = data.adset_name || data.utm_content || data.adset || null;
        const dob = data.dob || data.data_nascimento || null;
        const city = data.city || data.cidade || null;
        const state = data.state || data.estado || data.uf || null;

        console.log(`🚀 [SITE] RECEBIDO: ${firstName} | Campanha: ${campaign || 'N/A'}`);

        let webLeadId = null;
        let isNewLead = true;

        const checkQuery = `SELECT facebook_lead_id, created_time FROM leads WHERE (email = $1 OR phone = $2) AND created_time > $3 ORDER BY created_time DESC LIMIT 1`;
        const oneDayAgo = Math.floor(Date.now() / 1000) - 86400; 
        const existingLead = await client.query(checkQuery, [email, phone, oneDayAgo]);

        if (existingLead.rows.length > 0) {
            webLeadId = existingLead.rows[0].facebook_lead_id;
            isNewLead = false;
        } else {
            webLeadId = data.custom_id || `WEB-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        }

        const createdTime = isNewLead ? Math.floor(Date.now() / 1000) : existingLead.rows[0].created_time;

        const queryText = `
            INSERT INTO leads (
                facebook_lead_id, created_time, email, phone, first_name, last_name, 
                fbc, fbp, client_ip_address, client_user_agent, platform, is_organic, form_name,
                dob, city, estado, campaign_name, adset_name
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'site_smartcred', false, 'Formulario Site', $11, $12, $13, $14, $15)
            ON CONFLICT (facebook_lead_id) DO UPDATE SET
                email = COALESCE(EXCLUDED.email, leads.email),
                phone = COALESCE(EXCLUDED.phone, leads.phone),
                first_name = COALESCE(EXCLUDED.first_name, leads.first_name),
                campaign_name = COALESCE(EXCLUDED.campaign_name, leads.campaign_name),
                adset_name = COALESCE(EXCLUDED.adset_name, leads.adset_name);
        `;

        await client.query(queryText, [
            webLeadId, createdTime, email, phone, firstName, lastName, 
            data.fbc, data.fbp, ip, userAgent,
            dob, city, state, campaign, adset
        ]);

        res.status(200).json({ success: true, id: webLeadId });

    } catch (error) {
        console.error('❌ [ERRO] Falha ao salvar:', error);
        res.status(500).json({ success: false });
    } finally {
        client.release();
    }
});

// ============================================================================
// 3. ROTA DE WEBHOOK
// ============================================================================
app.post('/webhook', async (req, res) => {
    console.log("--- 🔔 Webhook Recebido ---");
    try {
        const leadData = req.body;
        const crmEventName = leadData.tag ? leadData.tag.name : null;
        const facebookEventName = mapCRMEventToFacebookEvent(crmEventName);

        if (!facebookEventName) return res.status(200).send('Ignorado.');
        if (!leadData.lead) return res.status(400).send('Sem dados.');
        
        const leadEmail = leadData.lead.email ? leadData.lead.email.toLowerCase().trim() : null;
        let leadPhone = leadData.lead.phone ? leadData.lead.phone.replace(/\D/g, '') : null;
        let crmFirstName = leadData.lead.first_name || '';
        let crmLastName = leadData.lead.last_name || '';

        if (!crmFirstName && leadData.lead.name) {
             const parts = leadData.lead.name.split(' ');
             crmFirstName = parts[0];
             crmLastName = parts.slice(1).join(' ');
        }

        let searchPhone = leadPhone;
        if (searchPhone && searchPhone.startsWith('55') && searchPhone.length > 11) searchPhone = searchPhone.substring(2);
        let phoneSuffix = (leadPhone && leadPhone.length >= 8) ? leadPhone.slice(-8) : '';

        let dbRow;
        let attempts = 0;
        
        while (attempts < 5) {
            attempts++;
            const result = await pool.query(`
                SELECT * FROM leads WHERE (email IS NOT NULL AND email = $1) OR (phone IS NOT NULL AND phone LIKE '%' || $2) OR (phone IS NOT NULL AND $3 <> '' AND phone LIKE '%' || $3) ORDER BY created_time ASC LIMIT 1
            `, [leadEmail, searchPhone || '0000', phoneSuffix]);
            
            if (result.rows.length > 0) {
                dbRow = result.rows[0];
                break; 
            } else {
                if (attempts < 5) await sleep(3000);
            }
        }

        if (!dbRow && crmFirstName) {
            const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
            const nameResult = await pool.query(`SELECT * FROM leads WHERE first_name ILIKE $1 AND (last_name ILIKE $2 OR $2 = '') AND created_time > $3 LIMIT 1`, [crmFirstName, crmLastName, oneDayAgo]);
            if (nameResult.rows.length > 0) dbRow = nameResult.rows[0];
        }

        if (!dbRow) return res.status(200).send('Não encontrado.');

        const isSiteLead = dbRow.facebook_lead_id && String(dbRow.facebook_lead_id).startsWith('WEB-');
        const now = Math.floor(Date.now() / 1000);
        if (facebookEventName === 'Lead' && isSiteLead && (now - Number(dbRow.created_time)) > 7200) {
            return res.status(200).send('Bloqueado: Lead Antigo.');
        }

        if (dbRow.last_sent_event === facebookEventName) {
            return res.status(200).send('Duplicado.');
        }

        const PIXEL_ID = process.env.PIXEL_ID;
        const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
        const userData = {
            em: dbRow.email ? [crypto.createHash('sha256').update(dbRow.email).digest('hex')] : [],
            ph: dbRow.phone ? [crypto.createHash('sha256').update(dbRow.phone).digest('hex')] : []
        };
        if (dbRow.fbc) userData.fbc = dbRow.fbc;
        if (dbRow.fbp) userData.fbp = dbRow.fbp;

        let currentActionSource = (facebookEventName === 'Lead' || facebookEventName === 'CompleteRegistration') ? 'website' : 'system_generated';

        await axios.post(`https://graph.facebook.com/v24.0/${PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`, {
            data: [{
                event_name: facebookEventName,
                event_time: Math.floor(Date.now() / 1000),
                event_id: `${dbRow.facebook_lead_id}_${facebookEventName}`,
                action_source: currentActionSource,
                user_data: userData
            }]
        });

        await pool.query("UPDATE leads SET last_sent_event = $1 WHERE facebook_lead_id = $2", [facebookEventName, dbRow.facebook_lead_id]);
        res.status(200).send('Enviado.');
    } catch (error) {
        console.error('❌ Erro Webhook:', error.message);
        res.status(500).send('Erro.');
    }
});

// ============================================================================
// 4. ROTA DE BACKUP
// ============================================================================
app.get('/baixar-backup', async (req, res) => {
    const client = await pool.connect();
    try {
        const queryText = `SELECT * FROM leads ORDER BY created_time DESC`;
        const result = await client.query(queryText);
        if (result.rows.length === 0) return res.send('Banco vazio.');
        
        let csv = 'id;created_time;name;email;phone;campaign;adset;status\n';
        result.rows.forEach(row => {
            let date = new Date(Number(row.created_time) * 1000).toISOString();
            csv += `${row.facebook_lead_id};${date};${row.first_name};${row.email};${row.phone};${row.campaign_name};${row.adset_name};${row.last_sent_event}\n`;
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="leads_smartcred.csv"');
        res.status(200).send(csv);
    } finally { client.release(); }
});

// ============================================================================
// 5. ROTA DE IMPORTAÇÃO
// ============================================================================
app.get('/importar', (req, res) => {
     res.send(`<!DOCTYPE html><html><body><h1>Importar Leads</h1><p>Use Postman.</p></body></html>`);
});
app.post('/import-leads', async (req, res) => {
    const leadsToImport = req.body;
    if (!Array.isArray(leadsToImport)) return res.status(400).send('JSON Inválido');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const queryText = `
            INSERT INTO leads (facebook_lead_id, created_time, email, phone, first_name, last_name, dob, city, estado, zip_code, campaign_name, adset_name, platform, form_name, is_organic)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (facebook_lead_id) DO NOTHING;
        `;
        for (const l of leadsToImport) {
             const id = l.id || l.facebook_lead_id;
             if(!id) continue;
             let time = l.created_time;
             if(String(time).includes('-')) time = Math.floor(new Date(time).getTime()/1000);
             
             await client.query(queryText, [
                 id, time, l.email, l.phone, l.first_name, l.last_name, l.dob, l.city, l.state, l.zip_code, l.campaign_name, l.adset_name, l.platform, l.form_name, false
             ]);
        }
        await client.query('COMMIT');
        res.status(201).send('Importado.');
    } catch(e) { 
        await client.query('ROLLBACK');
        res.status(500).send(e.message); 
    } finally { client.release(); }
});

// ============================================================================
// 6. DASHBOARD ANALÍTICO (V8.28 - PERIODOS AJUSTADOS)
// ============================================================================

app.get('/dashboard', (req, res) => {
    const SENHA_MESTRA = 'smart2026'; 
    const senhaDigitada = req.query.senha;

    if (senhaDigitada !== SENHA_MESTRA) {
        return res.status(403).send('<h1 style="text-align:center;margin-top:50px">🔒 Acesso Negado</h1>');
    }

    res.send(`
<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Monitoramento Leads SmartCred</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
    <style>
        body { background-color: #0f172a; color: #e2e8f0; font-family: sans-serif; }
        .card { background-color: #1e293b; border-radius: 12px; padding: 20px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2); }
        .scroll-custom::-webkit-scrollbar { width: 6px; }
        .scroll-custom::-webkit-scrollbar-thumb { background-color: #475569; border-radius: 4px; }
    </style>
</head>
<body class="p-6">
    <div class="max-w-7xl mx-auto">
        
        <div class="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
            <div>
                <h1 class="text-3xl font-bold text-white tracking-tight">Monitoramento de Leads SmartCred</h1>
                <p class="text-slate-400 text-sm mt-1">Análise em tempo real: Site & Formulários Nativos</p>
            </div>
            <div class="flex gap-2 bg-slate-800 p-1 rounded-lg overflow-x-auto">
                <button onclick="carregarDados('tres_dias')" class="px-4 py-2 bg-blue-600 rounded-lg text-sm hover:bg-blue-500 transition font-bold text-white shadow-lg whitespace-nowrap" id="btn-tres_dias">3 Dias</button>
                <button onclick="carregarDados('semana')" class="px-4 py-2 bg-transparent rounded-lg text-sm hover:bg-slate-700 transition text-slate-300 whitespace-nowrap" id="btn-semana">7 Dias</button>
                <button onclick="carregarDados('quinzena')" class="px-4 py-2 bg-transparent rounded-lg text-sm hover:bg-slate-700 transition text-slate-300 whitespace-nowrap" id="btn-quinzena">15 Dias</button>
                <button onclick="carregarDados('trinta_dias')" class="px-4 py-2 bg-transparent rounded-lg text-sm hover:bg-slate-700 transition text-slate-300 whitespace-nowrap" id="btn-trinta_dias">30 Dias</button>
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div class="card border-t-4 border-blue-500">
                <h3 class="text-slate-400 text-xs uppercase font-bold">Total Leads (Entrada)</h3>
                <div class="flex items-baseline mt-2">
                    <p class="text-4xl font-bold text-white" id="kpi-total">0</p>
                </div>
            </div>
            <div class="card border-t-4 border-indigo-500">
                <h3 class="text-slate-400 text-xs uppercase font-bold">Origem Site (WEB)</h3>
                <p class="text-4xl font-bold text-white mt-2" id="kpi-site">0</p>
            </div>
            <div class="card border-t-4 border-cyan-500">
                <h3 class="text-slate-400 text-xs uppercase font-bold">Origem Facebook (Form)</h3>
                <p class="text-4xl font-bold text-white mt-2" id="kpi-fb">0</p>
            </div>
            <div class="card border-t-4 border-green-500 bg-slate-800">
                <h3 class="text-slate-400 text-xs uppercase font-bold">Vendas (Vencemos)</h3>
                <p class="text-4xl font-bold text-green-400 mt-2" id="kpi-vendas">0</p>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div class="card lg:col-span-2">
                <h2 class="text-lg font-semibold mb-1 text-white flex items-center gap-2">
                    <span class="w-2 h-6 bg-blue-500 rounded-full"></span> Funil de Vendas (Etapas)
                </h2>
                <div id="chart-funnel"></div>
            </div>

            <div class="flex flex-col gap-6">
                <div class="card flex-1">
                    <h2 class="text-lg font-semibold mb-4 text-white">Share de Origem</h2>
                    <div id="chart-donut"></div>
                </div>
                <div class="card">
                    <h2 class="text-lg font-semibold text-white">Idade Média</h2>
                    <p class="text-xs text-slate-400 mb-2">Baseado em dados válidos</p>
                    <div class="flex items-center justify-center py-4">
                        <span class="text-5xl font-bold text-indigo-400" id="kpi-idade">--</span>
                        <span class="text-xl text-slate-500 ml-2">anos</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div class="card">
                <h2 class="text-lg font-semibold mb-4 text-white border-b border-slate-700 pb-2">Top Campanhas</h2>
                <div class="overflow-x-auto max-h-64 scroll-custom">
                    <table class="w-full text-sm text-left text-slate-300">
                        <tbody id="table-campanhas"></tbody>
                    </table>
                </div>
            </div>

            <div class="card">
                <h2 class="text-lg font-semibold mb-4 text-white border-b border-slate-700 pb-2">Top Conjuntos (Adset)</h2>
                <div class="overflow-x-auto max-h-64 scroll-custom">
                    <table class="w-full text-sm text-left text-slate-300">
                        <tbody id="table-adsets"></tbody>
                    </table>
                </div>
            </div>

            <div class="card">
                <h2 class="text-lg font-semibold mb-4 text-white border-b border-slate-700 pb-2">Top Estados (UF)</h2>
                <div class="overflow-x-auto max-h-64 scroll-custom">
                    <table class="w-full text-sm text-left text-slate-300">
                        <tbody id="table-estados"></tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>

    <script>
        Apex.grid = { borderColor: '#334155' };
        Apex.chart = { background: 'transparent', toolbar: { show: false } };
        Apex.tooltip = { theme: 'dark' };

        let chartFunnelObj = null;
        let chartDonutObj = null;

        async function carregarDados(periodo) {
            ['tres_dias', 'semana', 'quinzena', 'trinta_dias'].forEach(p => {
                const btn = document.getElementById('btn-' + p);
                if (!btn) return;
                if(p === periodo) {
                    btn.classList.remove('bg-transparent', 'text-slate-300');
                    btn.classList.add('bg-blue-600', 'text-white', 'shadow-lg');
                } else {
                    btn.classList.add('bg-transparent', 'text-slate-300');
                    btn.classList.remove('bg-blue-600', 'text-white', 'shadow-lg');
                }
            });

            try {
                const res = await fetch('/api/kpis?periodo=' + periodo);
                const data = await res.json();
                atualizarInterface(data);
            } catch (e) { console.error('Erro:', e); }
        }

        function atualizarInterface(data) {
            document.getElementById('kpi-total').innerText = data.total;
            document.getElementById('kpi-site').innerText = data.totalSite;
            document.getElementById('kpi-fb').innerText = data.totalFb;
            document.getElementById('kpi-vendas').innerText = data.funil.vencemos;
            document.getElementById('kpi-idade').innerText = data.idadeMedia > 0 ? data.idadeMedia : '--';

            const categories = ['Novos', '1. Atendeu', '2. Oportunidade', '3. Avançado', '4. Vídeo', '5. Vencemos'];
            const seriesData = [data.total, data.funil.atendeu, data.funil.oportunidade, data.funil.avancado, data.funil.video, data.funil.vencemos];

            if (chartFunnelObj) chartFunnelObj.destroy();
            chartFunnelObj = new ApexCharts(document.querySelector("#chart-funnel"), {
                series: [{ name: 'Leads', data: seriesData }],
                chart: { type: 'bar', height: 350 },
                plotOptions: { bar: { borderRadius: 4, horizontal: true, barHeight: '60%', distributed: true } },
                colors: ['#64748b', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#10b981'],
                dataLabels: { enabled: true },
                xaxis: { categories: categories, labels: { style: { colors: '#cbd5e1' } } },
                yaxis: { labels: { style: { colors: '#cbd5e1' } } },
                legend: { show: false }
            });
            chartFunnelObj.render();

            if (chartDonutObj) chartDonutObj.destroy();
            chartDonutObj = new ApexCharts(document.querySelector("#chart-donut"), {
                series: [data.totalSite, data.totalFb],
                labels: ['Site (Web)', 'Facebook (Nativo)'],
                chart: { type: 'donut', height: 250 },
                colors: ['#3b82f6', '#06b6d4'],
                legend: { position: 'bottom', labels: { colors: '#cbd5e1' } },
                stroke: { show: false }
            });
            chartDonutObj.render();

            const renderTable = (id, list) => {
                document.getElementById(id).innerHTML = list.map(c => 
                    \`<tr class="border-b border-slate-700 hover:bg-slate-700/50"><td class="px-4 py-3 font-medium text-white truncate max-w-xs" title="\${c.nome}">\${c.nome}</td><td class="px-4 py-3 text-right font-bold text-blue-400">\${c.qtd}</td></tr>\`
                ).join('');
            };

            renderTable('table-campanhas', data.topCampanhas);
            renderTable('table-adsets', data.topAdsets);
            renderTable('table-estados', data.topEstados);
        }

        // CARREGA 3 DIAS POR PADRÃO
        carregarDados('tres_dias');
    </script>
</body>
</html>
    `);
});

app.get('/api/kpis', async (req, res) => {
    const { periodo } = req.query; 
    const client = await pool.connect();
    try {
        const now = new Date();
        now.setHours(now.getHours() - 3); // BRT
        
        // CALCULO DE DATAS DINAMICO
        let daysToSubtract = 0;
        if (periodo === 'tres_dias') daysToSubtract = 3;
        else if (periodo === 'semana') daysToSubtract = 7;
        else if (periodo === 'quinzena') daysToSubtract = 15;
        else if (periodo === 'trinta_dias') daysToSubtract = 30;
        else daysToSubtract = 3; // Fallback

        const startDate = new Date(now);
        startDate.setDate(startDate.getDate() - daysToSubtract);
        startDate.setHours(0,0,0,0);
        
        const startTimestamp = Math.floor(startDate.getTime() / 1000);

        const queryText = `
            SELECT facebook_lead_id, last_sent_event, campaign_name, adset_name, platform, estado, dob 
            FROM leads 
            WHERE created_time >= $1
        `;
        const result = await client.query(queryText, [startTimestamp]);
        
        const stats = {
            total: 0,
            totalSite: 0,
            totalFb: 0,
            funil: { atendeu: 0, oportunidade: 0, avancado: 0, video: 0, vencemos: 0 },
            topCampanhas: [],
            topAdsets: [],
            topEstados: [],
            idadeMedia: 0
        };

        const campanhasMap = {};
        const adsetsMap = {};
        const estadosMap = {};
        let somaIdade = 0;
        let qtdIdadeValida = 0;

        result.rows.forEach(row => {
            stats.total++;
            const isWeb = row.facebook_lead_id && String(row.facebook_lead_id).startsWith('WEB-');
            if (isWeb) stats.totalSite++; else stats.totalFb++;

            const st = row.last_sent_event ? row.last_sent_event.toUpperCase() : '';
            if (st === 'ATENDEU') stats.funil.atendeu++;
            else if (st === 'OPORTUNIDADE') stats.funil.oportunidade++;
            else if (st === 'AVANÇADO') stats.funil.avancado++;
            else if (st === 'VÍDEO' || st === 'VIDEO') stats.funil.video++;
            else if (st === 'VENCEMOS' || st === 'VENDA') stats.funil.vencemos++;

            const campName = row.campaign_name || 'Sem Campanha';
            campanhasMap[campName] = (campanhasMap[campName] || 0) + 1;

            const adsetName = row.adset_name || 'Sem Conjunto';
            adsetsMap[adsetName] = (adsetsMap[adsetName] || 0) + 1;

            const estName = row.estado ? row.estado.toUpperCase() : 'N/D';
            if (estName.length === 2) estadosMap[estName] = (estadosMap[estName] || 0) + 1;

            if (row.dob) {
                let anoNasc = 0;
                const dobStr = String(row.dob);
                if (dobStr.includes('-')) anoNasc = parseInt(dobStr.split('-')[0]);
                else if (dobStr.includes('/')) {
                    const parts = dobStr.split('/');
                    if (parts.length === 3) anoNasc = parseInt(parts[2]);
                } else if (dobStr.length === 4) anoNasc = parseInt(dobStr);

                if (anoNasc > 1940 && anoNasc < 2010) {
                    const idade = new Date().getFullYear() - anoNasc;
                    if (idade >= 18 && idade <= 75) {
                        somaIdade += idade;
                        qtdIdadeValida++;
                    }
                }
            }
        });

        const sortMap = (map) => Object.entries(map).map(([nome, qtd]) => ({ nome, qtd })).sort((a, b) => b.qtd - a.qtd).slice(0, 5);

        stats.topCampanhas = sortMap(campanhasMap);
        stats.topAdsets = sortMap(adsetsMap);
        stats.topEstados = sortMap(estadosMap);
        stats.idadeMedia = qtdIdadeValida > 0 ? Math.round(somaIdade / qtdIdadeValida) : 0;

        res.json(stats);

    } catch (error) {
        console.error(error);
        res.status(500).json({
