// scripts/build_email_pairs.mjs
// Generates PAIRS of emails that match your site's schema and appends them as new groups.
// - Reads root emails.json (keeps your existing data)
// - Archives it to archive/emails_<timestamp>.json
// - Generates N pairs (2N emails) with exactly one "phish" and one "safe" per pair
// - Saves a new-only file generated_email_pairs_<timestamp>.json
// - Appends as email_group_<next_index> ... to root emails.json
//
// Control via env (GitHub Action inputs):
//   OPENAI_API_KEY   (required, GitHub secret)
//   EMAIL_TOPICS     (optional, e.g., "HR|Finance|IT|SSO|Password Reset")
//   PAIRS_COUNT      (optional, default 10) -> 50 pairs = 100 emails
//
// IMPORTANT: Schema per email (must match your site):
//   { subject: string, from: string, to: [string], desc: string, correct: "phish"|"safe", explain: string }

import fs from "fs";
import path from "path";
import OpenAI from "openai";

const ROOT = process.cwd();
const MAIN_FILE = path.join(ROOT, "emails.json");      // your live file (root)
const ARCHIVE_DIR = path.join(ROOT, "archive");

const PAIRS_COUNT = Number(process.env.PAIRS_COUNT || "50"); // default 50 pairs
const EMAIL_TOPICS = process.env.EMAIL_TOPICS || "";         // e.g., "HR|Finance|IT"
const MODEL = "gpt-4o-mini";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function ts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function readJSONSafe(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function ensureArchiveDir() {
  if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

function nextGroupIndex(doc) {
  let maxN = 0;
  if (doc && typeof doc === "object") {
    Object.keys(doc).forEach(k => {
      const m = k.match(/^email_group_(\d+)$/);
      if (m) {
        const n = Number(m[1]);
        if (n > maxN) maxN = n;
      }
    });
  }
  return maxN + 1;
}

function normalizeEmail(x) {
  if (!x) return null;
  const subject = (x.subject || "").toString().trim();
  const from = (x.from || "").toString().trim();
  const desc = (x.desc || "").toString().trim();
  let to = Array.isArray(x.to) ? x.to : (x.to ? [x.to] : []);
  to = to.map(s => s.toString().trim()).filter(Boolean);
  const correct = (x.correct || "").toString().toLowerCase();
  const explain = (x.explain || x.explanation || "").toString().trim();

  const okCorrect = correct === "phish" || correct === "safe";
  if (!subject || !from || !desc || !to.length || !okCorrect || !explain) return null;

  return { subject, from, to, desc, correct, explain };
}

function extractJSONArray(text) {
  const m = text.match(/\[[\s\S]*\]/);
  return m ? m[0] : "[]";
}

async function askPairsBatch(count, topicsHint) {
  const sys = `You generate realistic corporate emails for a phishing training game.
Return ONLY a JSON array where EACH element is a PAIR object with this shape:
{
  "pair": [
    {
      "subject": "string",
      "from": "name@domain.tld",
      "to": ["employee@company.com"],
      "desc": "short body/summary",
      "correct": "phish" | "safe",
      "explain": "reasoning in one or two sentences"
    },
    {
      "subject": "string",
      "from": "name@domain.tld",
      "to": ["employee@company.com"],
      "desc": "short body/summary",
      "correct": "phish" | "safe",
      "explain": "reasoning in one or two sentences"
    }
  ]
}
Rules:
- Exactly ONE of the two emails in each pair must have "correct":"phish" and the other must be "safe".
- No code fences, no prose, just valid JSON array of { "pair": [ ...2 emails... ] } objects.
- Keep each email concise (<= 280 characters for desc).
- Vary departments (HR, Finance, IT, Facilities, etc.) and make phish indicators realistic (domain lookalikes, urgency, attachments).`;

  const user = `Create ${count} PAIRS of corporate emails for training.${
    topicsHint ? ` Focus especially on: ${topicsHint}.` : ""
  } Ensure each pair has ONE "phish" and ONE "safe".`;

  const resp = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.3,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user }
    ]
  });

  const raw = resp.choices?.[0]?.message?.content || "[]";
  return JSON.parse(extractJSONArray(raw)); // array of { "pair": [emailA, emailB] }
}

async function generatePairs(totalPairs, topicsHint) {
  const pairs = await askPairsBatch(totalPairs, topicsHint);
  const out = [];
  for (const p of pairs) {
    const arr = Array.isArray(p?.pair) ? p.pair : [];
    if (arr.length !== 2) continue;
    const a = normalizeEmail(arr[0]);
    const b = normalizeEmail(arr[1]);
    if (!a || !b) continue;
    const hasOnePhish = (a.correct === "phish" && b.correct === "safe") ||
                        (a.correct === "safe" && b.correct === "phish");
    if (!hasOnePhish) continue;
    out.push([a, b]);
  }
  return out;
}

async function main() {
  ensureArchiveDir();

  const current = readJSONSafe(MAIN_FILE) || {};
  const stamp = ts();

  const archiveFile = path.join(ARCHIVE_DIR, `emails_${stamp}.json`);
  fs.writeFileSync(archiveFile, JSON.stringify(current, null, 2));

  const pairs = await generatePairs(PAIRS_COUNT, EMAIL_TOPICS);

  const newOnlyFile = path.join(ARCHIVE_DIR, `generated_email_pairs_${stamp}.json`);
  fs.writeFileSync(newOnlyFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    count_pairs: pairs.length,
    pairs
  }, null, 2));

  let next = nextGroupIndex(current);
  for (const pair of pairs) {
    current[`email_group_${next}`] = pair;
    next++;
  }

  fs.writeFileSync(MAIN_FILE, JSON.stringify(current, null, 2));

  console.log(`Archived -> ${path.relative(ROOT, archiveFile)}`);
  console.log(`New-only -> ${path.relative(ROOT, newOnlyFile)} (${pairs.length} pairs)`);
  console.log(`Merged  -> ${path.relative(ROOT, MAIN_FILE)} (now up to email_group_${next-1})`);
}

await main();
