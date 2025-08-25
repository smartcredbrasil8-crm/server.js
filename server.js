const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

// Substitua pelos seus valores
const PIXEL_ID = '568969266119506';
const ACCESS_TOKEN = 'EAADU2T8mQZAUBPRbatdIN038ucTUcp7O8tENhNCZBvX5LCGBzpcawiN7ZAiTG75X9o5cbJP8Kc2BZAoo3FEJGtZAzCEuXNxPpWEoYxGnbfuBleZAnfthkWmMENBRsB5u2rD2DBB7Q36t2tSRhec8tZA2IKt5h2EzSonvy6oClmbVH6lGaVRsB7xcdUkpsZCLv8ZCw3AZDZD';

// Permitir receber JSON
app.use(bodyParser.json());

// Rota para receber webhook do CRM
app.post('/lead-event', async (req, res) => {
  try {
    const { etapa, leadId, email } = req.body;

    // Nome do evento baseado na etapa
    const eventoMap = {
      1: 'Lead_Atendeu',
      2: 'Lead_Oportunidade',
      3: 'Lead_Avancado',
      4: 'Lead_Video',
      5: 'Lead_Vencemos'
    };

    const nomeEvento = eventoMap[etapa];

    if (!nomeEvento) {
      return res.status(400).send({ error: 'Etapa inválida' });
    }

    // Enviar evento pro Facebook Pixel via Conversions API
    const response = await axios.post(
      `https://graph.facebook.com/v23.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
      {
        data: [
          {
            event_name: nomeEvento,
            event_time: Math.floor(Date.now() / 1000),
            user_data: {
              em: [Buffer.from(email).toString('base64')]
            }
          }
        ]
      }
    );

    console.log('Evento enviado:', response.data);
    res.status(200).send({ success: true, data: response.data });

  } catch (error) {
    console.error('Erro ao enviar evento:', error.response?.data || error.message);
    res.status(500).send({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
