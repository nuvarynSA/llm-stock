/**
 * Minimal HTTP server for the self-contained demo.
 *
 * Mirrors the production endpoint `POST /ia/consultar` (see `src/ia/ia.controller.ts`, a
 * NestJS controller). The demo uses a thin Express server instead of the full NestJS stack
 * because it needs neither Prisma, JWT auth, throttling nor the quota persistence that the
 * real controller wires in — only the LLM tool-calling loop over mocked ERP data.
 */
import express from 'express';
import path from 'path';
import { GroqLoop } from './groq-loop';
import { MockToolRouter } from './mock-erp';
import {
  GroqRateLimitError,
  GroqUnavailableError,
} from '../ia/groq/groq-errors';

const PORT = Number(process.env.PORT ?? 3000);
const apiKey = process.env.GROQ_API_KEY ?? '';
const modelos = (process.env.GROQ_MODELS ?? process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

const loop = new GroqLoop(apiKey, modelos, new MockToolRouter());

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', groqKeyConfigured: apiKey.length > 0, modelos });
});

app.post('/ia/consultar', async (req, res) => {
  const pregunta = typeof req.body?.pregunta === 'string' ? req.body.pregunta.trim() : '';
  if (!pregunta) {
    return res.status(400).json({ message: 'El campo "pregunta" es obligatorio.' });
  }
  if (pregunta.length > 500) {
    return res.status(400).json({ message: 'La pregunta supera los 500 caracteres.' });
  }
  if (!apiKey) {
    return res.status(503).json({
      message: 'Falta GROQ_API_KEY. Configurá tu clave de Groq en el archivo .env (ver README).',
    });
  }

  try {
    const resultado = await loop.consultar(pregunta);
    return res.json({
      respuesta: resultado.respuesta,
      consultasUtilizadas: resultado.consultasUtilizadas,
      modeloUsado: resultado.modeloUsado,
      tokens: resultado.totalTokens,
      iteraciones: resultado.iteraciones,
    });
  } catch (error) {
    if (error instanceof GroqRateLimitError) {
      return res.status(429).json({
        message: `Se alcanzó el límite de consultas, probá de nuevo en ${error.retryAfter ?? 60}s.`,
        retryAfter: error.retryAfter,
      });
    }
    if (error instanceof GroqUnavailableError) {
      return res.status(503).json({ message: 'El servicio de consultas no está disponible, probá más tarde.' });
    }
    // eslint-disable-next-line no-console
    console.error(error);
    return res.status(500).json({ message: 'Error inesperado procesando la consulta.' });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[llm-stock demo] escuchando en http://localhost:${PORT} · modelos: ${modelos.join(', ')}`);
});
