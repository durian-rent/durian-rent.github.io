'use strict';

const fs = require('fs');
const { readdir, rmSync, mkdirSync } = require('node:fs/promises')
const path = require('path');
const { spawn } = require('child_process');

const FIELD_NAMES = [
  'bedrooms', 'bathrooms', 'floor', 'deposit_months', 'min_contract', 'furnished', 'washer',
  'air_condition', 'fridge', 'kitchen', 'tv', 'water_heater', 'elevator', 'motorbike_parking',
  'pool', 'gym', 'balcony', 'pets_allowed', 'view', 'cleaning_included', 'owner_direct',
  'contact_channel', 'foreign_allowed',
];

const FIELDS_JSON_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(FIELD_NAMES.map((key) => [key, { type: 'integer' }])),
  required: FIELD_NAMES,
  additionalProperties: false,
};

const TRANSLATE_SYSTEM_PROMPT = [
  'You translate Vietnamese rental listings from Da Nang into natural English for a rental website.',
  'Rules:',
  '- Translate everything. Do not summarize, do not skip lines, do not add anything.',
  '- Keep every number, price, area, phone mask and address exactly.',
  '- Shorthand: "tr"/"triệu" = million VND (7tr5 = 7.5 million VND, 3tr7 = 3.7 million VND, 20TR = 20 million VND); '
    + '"PN"/"p ngủ" = bedroom; "WC" = toilet/bathroom; "cọc" = deposit ("cọc 1 tháng" = 1-month deposit, '
    + '"đóng 3 cọc 1" = pay 3 months upfront plus 1 month deposit); "MT" = street-front; "kiệt"/"hẻm" = alley; '
    + '"LH" = contact; "full nội thất" = fully furnished; "gác lửng" = mezzanine.',
  '- Never translate or transliterate street, ward, district, building and project names: copy them exactly as '
    + 'written in the source, including diacritics. Example: "Vũ Đình Long" stays "Vũ Đình Long", never '
    + '"Wu Ding Long" or "Vu Dinh Long".',
  '- Keep the same layout: first line "Title: ...", then "Text:" and the translated text with the same line '
    + 'breaks. Output only the translation.',
].join('\n');

const TITLE_PREFILL = 'Title:';

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq === -1) flags[arg.slice(2)] = true;
      else flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    }
  }
  return flags
}

const flags = parseArgs(process.argv.slice(2));

function config(flagName, envName, fallback) {
  if (flags[flagName] !== undefined) return flags[flagName];
  if (process.env[envName] !== undefined) return process.env[envName];
  return fallback;
}

function requireConfig(flagName, envName, def) {
  const value = config(flagName, envName, def);
  if (value === undefined) {
    throw new Error(`Missing --${flagName} or $${envName}`);
  }
  return value;
}

const HOST = '127.0.0.1';
const LLAMA_SERVER_BIN = requireConfig('llama-bin', 'LLAMA_SERVER_BIN', './llama/llama-server');
const MODEL_GGUF = requireConfig('model', 'MODEL_GGUF', './model.gguf');
const ADAPTER_GGUF = requireConfig('adapter', 'ADAPTER_GGUF', './durian-lora.gguf');
const PORT = Number(config('port', 'LLAMA_PORT', 8091));
const THREADS = Number(config('threads', 'LLAMA_THREADS', 4));
const NP = Number(config('np', 'NP', 4));
const CTX_SIZE = Number(config('ctx', 'LLAMA_CTX', 4096));
const RESTART_EVERY = Number(config('restart-every', 'RESTART_EVERY', 40));
const REQUEST_TIMEOUT_MS = Number(config('timeout-ms', 'REQUEST_TIMEOUT_MS', 240000));
const SERVER_READY_TIMEOUT_MS = Number(config('server-timeout-ms', 'SERVER_READY_TIMEOUT_MS', 180000));
const USE_JSON_SCHEMA = config('json-schema', 'USE_JSON_SCHEMA', '1') === '1';

function buildPrompt(system, user) {
  return `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`;
}

function adUserText(ad) {
  return `Title: ${ad.title}\nText:\n${ad.body}`;
}

let serverProcess = null;

function startServer() {
  return new Promise((resolve, reject) => {
    const args = [
      '-m', MODEL_GGUF,
      '--lora', ADAPTER_GGUF,
      '-t', String(THREADS),
      '-tb', String(THREADS),
      '-c', String(CTX_SIZE),
      '-np', String(NP),
      '--port', String(PORT),
      '--no-webui',
    ];
    const child = spawn(LLAMA_SERVER_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    serverProcess = child;
    let startupLog = '';
    child.stderr.on('data', (chunk) => {
      startupLog += chunk.toString();
      if (startupLog.length > 20000) startupLog = startupLog.slice(-20000);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (serverProcess === child && code !== null && code !== 0) {
        console.error(`llama-server exited early with code ${code}\n${startupLog.slice(-2000)}`);
      }
    });

    const startedAt = Date.now();
    const poll = async () => {
      try {
        const r = await fetch(`http://${HOST}:${PORT}/health`);
        if (r.ok) {
          const body = await r.json();
          if (body.status === 'ok') return resolve();
        }
      } catch {
      }
      if (Date.now() - startedAt > SERVER_READY_TIMEOUT_MS) {
        return reject(new Error(`llama-server did not become healthy within ${SERVER_READY_TIMEOUT_MS}ms`));
      }
      setTimeout(poll, 1500);
    };
    poll();
  });
}

function stopServer() {
  return new Promise((resolve) => {
    const child = serverProcess;
    serverProcess = null;
    if (!child) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve();
    }, 5000);
  });
}

async function restartServer() {
  console.log('restarting llama-server');
  await stopServer();
  await startServer();
}

async function completionOnce(body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(`http://${HOST}:${PORT}/completion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

async function completionWithRetry(body, timeoutMs) {
  try {
    return await completionOnce(body, timeoutMs);
  } catch (err) {
    console.error(`request failed (${err.message}), retrying once`);
    return await completionOnce(body, timeoutMs);
  }
}


function parseFields(text) {
  let got;
  try {
    got = JSON.parse(text);
  } catch (_err) {
    return null;
  }
  if (typeof got !== 'object' || got === null) return null;
  const fields = {};
  for (const key of FIELD_NAMES) {
    const value = got[key];
    fields[key] = Number.isInteger(value) ? value : 0;
  }
  return fields;
}

const VI_WORDS = ['là', 'của', 'và', 'có', 'không', 'cho', 'thuê', 'phòng', 'giá', 'tháng', 'nhà', 'với', 'người', 'liên', 'hệ'];
const VI_FUNCTION_WORDS = new RegExp(`(?<![\\p{L}\\p{N}])(${VI_WORDS.join('|')})(?![\\p{L}\\p{N}])`, 'giu');

function looksVietnamese(text) {
  return (text.match(VI_FUNCTION_WORDS) || []).length >= 2;
}

function parseTranslation(text, fallbackTitle, fallbackBody) {
  const trimmed = text.trim();
  const match = trimmed.match(/^Title:\s*(.*?)\r?\n\s*Text:\s*\r?\n?([\s\S]*)$/i);
  if (match) {
    return { title_en: match[1].trim(), body_en: match[2].trim() };
  }
  if (trimmed && !looksVietnamese(trimmed)) {
    console.error(`translation skipped the "Title: / Text:" layout, using it as body_en: ${JSON.stringify(trimmed.slice(0, 200))}`);
    return { title_en: fallbackTitle, body_en: trimmed };
  }
  console.error(`translation still reads as Vietnamese, keeping source text: ${JSON.stringify(trimmed.slice(0, 300))}`);
  return { title_en: fallbackTitle, body_en: fallbackBody };
}

async function runFields(ad, systemPrompt) {
  const body = {
    prompt: buildPrompt(systemPrompt, adUserText(ad)),
    n_predict: 400,
    temperature: 0,
    cache_prompt: false,
    stop: ['<|im_end|>'],
    lora: [{ id: 0, scale: 1 }],
  };
  if (USE_JSON_SCHEMA) body.json_schema = FIELDS_JSON_SCHEMA;
  const r = await completionWithRetry(body, REQUEST_TIMEOUT_MS);
  if (!r.content) return
  const fields = parseFields(r.content);
  if (fields) return fields;
  console.error(`ad ${ad.id}: fields response was not valid JSON - skip`);
  return
}

async function runTranslate(ad) {
  const body = {
    prompt: buildPrompt(TRANSLATE_SYSTEM_PROMPT, adUserText(ad)) + TITLE_PREFILL,
    n_predict: 1024,
    temperature: 0,
    cache_prompt: false,
    stop: ['<|im_end|>'],
    lora: [{ id: 0, scale: 0 }],
  };
  const r = await completionWithRetry(body, REQUEST_TIMEOUT_MS);
  return parseTranslation(r.content ? TITLE_PREFILL + r.content : '', ad.title, ad.body);
}

async function main(ads) {
  ads = ads.map(ad => {
      return {
          id: ad.ad_id,
          title: ad.subject,
          body: ad.body
      }
  })
  const systemPrompt = `Read one Vietnamese rental ad from Da Nang and answer with one JSON object of the rental fields. Every value is a number. Put 0 when the ad does not say it.`

  const result = {};
  let sinceRestart = 0;
  let failures = 0;

  const cleanup = () => { if (serverProcess) serverProcess.kill('SIGKILL'); };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  await startServer();
  
  console.time(`total time using -np: ${NP}`)
  for (let i = 0; i < ads.length; i += NP) {
    const ad = ads[i];
    const t0 = Date.now();
    await Promise.all(
          ads.slice(i, i + NP).map(async (ad, j) => {
              const tFields0 = Date.now();
              const fields = await runFields(ad, systemPrompt);
              const tFields = ((Date.now() - tFields0) / 1000).toFixed(1);
              if (!fields) return
              //const tTr0 = Date.now();
              //const { title_en, body_en } = await runTranslate(ad);
              //const tTr = ((Date.now() - tTr0) / 1000).toFixed(1);

              result[ad.id] = fields//, title_en, body_en };
              //fs.writeFileSync(`ai-out/${ad.id}.json`, JSON.stringify(fields, null, 1))
              const total = ((Date.now() - t0) / 1000).toFixed(1);
              console.log(`${i + j + 1}/${ads.length} id ${ad.id}: ${total}s (fields ${tFields}s)`)//, translate ${tTr}s)`);
          })
    )
    

    sinceRestart += 1;
    if (sinceRestart >= RESTART_EVERY && i < ads.length - 1) {
      console.log(`restart checkpoint: ${sinceRestart} ads since last restart`);
      await restartServer();
      sinceRestart = 0;
    }
  }
  console.timeEnd(`total time using -np: ${NP}`)

  await stopServer();
  console.log(`done: ${ads.length} ads`);
  
  return result
}

module.exports = main
//main().catch((err) => {
//  console.error(err);
//  process.exit(1);
//});






