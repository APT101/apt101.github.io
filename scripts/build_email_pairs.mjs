// scripts/build_email_pairs.mjs
// - Reads root emails.json
// - Archives to archive/emails_<timestamp>.json
// - Generates N pairs (50–400 word desc, ~ATTACHMENT_RATE% attachments)
// - Writes archive/generated_email_pairs_<timestamp>.json
// - Appends to root emails.json as email_group_<next>

import fs from "fs";
import path from "path";
import OpenAI from "openai";

const ROOT = process.cwd();
const MAIN_FILE = path.join(ROOT, "emails.json");
const ARCHIVE_DIR = path.join(ROOT, "archive");

const PAIRS_COUNT = Number(process.env.PAIRS_COUNT || "10");
const EMAIL_TOPICS = process.env.EMAIL_TOPICS || "";
const MIN_WORDS = Number(process.env.MIN_WORDS || "50");
const MAX_WORDS = Number(process.env.MAX_WORDS || "400");
const ATTACHMENT_RATE = Number(process.env.ATTACHMENT_RATE || "50"); // percentage
const MODEL = "gpt-4o-mini";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function ts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function ensureArchiveDir() {
  if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

function readJSONSafe(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function nextGroupIndex(doc) {
  let maxN = 0;
  if (doc && typeof doc === "object") {
    for (const k of Object.keys(doc)) {
      const m = k.match(/^email_group_(\d+)$/);
      if (m) maxN = Math.max(maxN, Number(m[1]));
    }
  }
  return maxN + 1;
}

function extractJSONArray(text) {
  const m = text.match(/\[[\s\S]*\]/);
  return m ? m[0] : "[]";
}

function normalizeEmail(x) {
  if (!x) return null;
  const subject = String(x.subject || "").trim();
  const from = String(x.from || "").trim();
  const toArr = Array.isArray(x.to) ? x.to.map(s=>String(s).trim()).filter(Boolean)
            : (x.to ? [String(x.to).trim()] : []);
  const desc = String(x.desc || x.body || "").trim();
  const correct = String(x.correct || "").toLowerCase();
  const explain = String(x.explain || x.explanation || "").trim();
  const attachment = (x.attachment === undefined || x.attachment === null || x.attachment === "")
    ? undefined
    : String(x.attachment);

  if (!subject || !from || !toArr.length || !desc || !explain) return null;
  if (!(correct === "phish" || correct === "safe")) return null;

  const out = { subject, from, to: toArr, desc, correct, explain };
  if (attachment !== undefined) out.attachment = attachment;
  return out;
}

async function askPairsBatch(count, topicsHint) {
  const sys = `You generate realistic INTERNAL corporate email pairs for a phishing training game.

You MUST return ONLY a JSON array, where each element is an object with this exact shape:

{
  "pair": [
    {
      "subject": "string",
      "from": "name@domain.tld",
      "to": ["employee@company.com"],
      "attachment": "string (optional, e.g. \\"training.pdf\\" or \\"invoice.pdf.exe\\")",
      "desc": "full email body text",
      "correct": "phish" | "safe",
      "explain": "1–2 sentences explaining why this email is phishing or safe"
    },
    {
      "subject": "string",
      "from": "name@domain.tld",
      "to": ["employee@company.com"],
      "attachment": "string (optional, e.g. \\"training.pdf\\" or \\"invoice.pdf.exe\\")",
      "desc": "full email body text",
      "correct": "phish" | "safe",
      "explain": "1–2 sentences explaining why this email is phishing or safe"
    }
  ]
}

STRICT rules:

- EXACTLY one email in each "pair" must have "correct": "phish" and the other must have "correct": "safe".
- BOTH emails in the same "pair" MUST share the same theme/scenario
  (e.g., benefits update, payroll correction, travel itinerary, security notice, facilities update, legal policy, training invite, performance review, etc.).
- Write the "desc" field as a realistic business email:
  - Start with a greeting like "Dear Employee," or "Hi Team,".
  - Use 1–3 short paragraphs separated with \\n\\n.
  - End with a closing and signature, e.g. "Best regards,\\nMaria Thompson\\nHR Manager".
- Do NOT use HTML; plain text only in "desc".
- For SAFE emails:
  - Use correct company domains and normal tone.
  - No requests for passwords or sensitive personal data.
  - If you include links, make them normal-looking HTTPS links on the correct company domain.
- For PHISH emails:
  - Use at least one clear red flag such as:
    - lookalike or misspelled domains,
    - executable attachment (like .pdf.exe or .exe),
    - urgent or threatening language,
    - credential / payment / personal data requests,
    - suspicious non-HTTPS links.
- Output pure JSON only: no Markdown, no comments, no extra text before or after the JSON array.`;

  const user = `Create ${count} PAIRS of internal corporate emails for phishing training.${
    topicsHint ? ` Try to include these themes: ${topicsHint}.` : ""
  }

For EACH email:
- Choose an approximate body length between ${MIN_WORDS} and ${MAX_WORDS} words.
- Write the body in the "desc" field as a full email (greeting, paragraphs, closing) using \\n\\n between paragraphs.
- Include an "attachment" field in about ${ATTACHMENT_RATE}% of emails overall:
  - Safe examples: "benefits_overview.pdf", "meeting_agenda.pdf", "training_materials.pdf".
  - Phish examples: "benefits_overview.pdf.exe", "invoice_details.pdf.exe", "security_update.exe".
- Ensure each "pair" has ONE "phish" and ONE "safe" email, both clearly about the SAME scenario.
- Return ONLY a JSON array of objects in the exact format specified in the system message (no wrapping object, no prose).`;

  const resp = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.4,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user }
    ]
  });

  const raw = resp.choices?.[0]?.message?.content || "[]";
  return JSON.parse(extractJSONArray(raw));
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
    const labels = [a.correct, b.correct].sort().join(",");
    if (labels !== "phish,safe") continue;
    out.push([a, b]);
  }
  return out;
}

async function main() {
  ensureArchiveDir();

  const current = readJSONSafe(MAIN_FILE) || {};
  const stamp = ts();

  // 1) backup
  const archiveFile = path.join(ARCHIVE_DIR, `emails_${stamp}.json`);
  fs.writeFileSync(archiveFile, JSON.stringify(current, null, 2));

  // 2) generate
  let pairs = await generatePairs(PAIRS_COUNT, EMAIL_TOPICS);

  // 3) write new-only snapshot (into archive/)
  const newOnlyFile = path.join(ARCHIVE_DIR, `generated_email_pairs_${stamp}.json`);
  fs.writeFileSync(newOnlyFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    count_pairs: pairs.length,
    pairs
  }, null, 2));

  // 4) append into root emails.json
  let next = nextGroupIndex(current);
  for (const pair of pairs) {
    current[`email_group_${next}`] = pair;
    next++;
  }
  current.last_updated_emails = new Date().toISOString();

  fs.writeFileSync(MAIN_FILE, JSON.stringify(current, null, 2));

  console.log(`Archived -> ${path.relative(ROOT, archiveFile)}`);
  console.log(`New-only -> ${path.relative(ROOT, newOnlyFile)} (${pairs.length} pairs)`);
  console.log(`Merged  -> ${path.relative(ROOT, MAIN_FILE)} (now up to email_group_${next-1})`);
}

await main();