import { Prisma } from '@prisma/client';

export interface PrecioModelo {
  inputPorMillion: Prisma.Decimal;
  outputPorMillion: Prisma.Decimal;
}

/**
 * Precio USD por millón de tokens de cada modelo candidato de `GROQ_MODELS` (spec
 * `compartido/17Anexo`, `openai/gpt-oss-120b` / `openai/gpt-oss-20b` / `qwen/qwen3.6-27b` /
 * `qwen/qwen3.8-27b`) — spec `compartido/20`.
 *
 * `openai/gpt-oss-120b` y `openai/gpt-oss-20b`: precio real verificado contra la doc de
 * precios de Groq (2026-09-09). Los dos `qwen/qwen3.*-27b`: identificadores puntuales sin
 * match confiable en la doc pública de Groq al verificar — usan el precio de
 * `openai/gpt-oss-120b` (el más caro de los verificados) como fallback conservador, nunca 0.
 * Corregir con el precio real apenas se pueda verificar contra la cuenta de Groq.
 */
const PRECIO_GPT_OSS_120B: PrecioModelo = {
  inputPorMillion: new Prisma.Decimal('0.15'),
  outputPorMillion: new Prisma.Decimal('0.60'),
};

const PRECIO_GPT_OSS_20B: PrecioModelo = {
  inputPorMillion: new Prisma.Decimal('0.075'),
  outputPorMillion: new Prisma.Decimal('0.30'),
};

const PRECIOS: Record<string, PrecioModelo> = {
  'openai/gpt-oss-120b': PRECIO_GPT_OSS_120B,
  'openai/gpt-oss-20b': PRECIO_GPT_OSS_20B,
  // Sin precio verificado — fallback conservador (ver comentario de cabecera).
  'qwen/qwen3.6-27b': PRECIO_GPT_OSS_120B,
  // Sin precio verificado — fallback conservador (ver comentario de cabecera).
  'qwen/qwen3.8-27b': PRECIO_GPT_OSS_120B,
};

/** Precio del modelo, o el fallback conservador (`openai/gpt-oss-120b`) si no está en la tabla. */
export function precioDe(modelo: string): PrecioModelo {
  return PRECIOS[modelo] ?? PRECIO_GPT_OSS_120B;
}
