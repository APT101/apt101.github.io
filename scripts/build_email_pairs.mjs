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
const ATTACHMENT_RATE = Number(process.env.ATTACHMENT_RATE || "50"); // percentage of PAIRS
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

// -------- NEW: enforce strict ATTACHMENT_RATE on PAIRS ----------
function enforceAttachmentRateOnPairs(pairs) {
  const totalPairs = pairs.length;
  if (!totalPairs) return pairs;

  const targetAttachedPairs = Math.round((ATTACHMENT_RATE / 100) * totalPairs);

  // Find which pairs currently have attachments (both emails considered as one unit)
  const attachedPairIdx = [];
  const noAttachmentPairIdx = [];

  for (let i = 0; i < totalPairs; i++) {
    const [a, b] = pairs[i];
    const hasAttachment = !!(a.attachment || b.attachment);
    if (hasAttachment) {
      attachedPairIdx.push(i);
    } else {
      noAttachmentPairIdx.push(i);
    }
  }

  let currentAttachedPairs = attachedPairIdx.length;

  // Helper: simple array shuffle
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // If we have too many attached pairs, remove attachments from some
  if (currentAttachedPairs > targetAttachedPairs) {
    const toRemoveCount = currentAttachedPairs - targetAttachedPairs;
    shuffle(attachedPairIdx);
    const idxToStrip = attachedPairIdx.slice(0, toRemoveCount);
    for (const pairIndex of idxToStrip) {
      const [a, b] = pairs[pairIndex];
      delete a.attachment;
      delete b.attachment;
    }
    currentAttachedPairs = targetAttachedPairs;
  }

  // If we have too few attached pairs, add attachments to some attachment-less pairs
  if (currentAttachedPairs < targetAttachedPairs) {
    const toAddCount = Math.min(targetAttachedPairs - currentAttachedPairs, noAttachmentPairIdx.length);
    shuffle(noAttachmentPairIdx);
    const idxToAdd = noAttachmentPairIdx.slice(0, toAddCount);

    const safeNames = [
      "training.pdf",
      "report.pdf",
      "benefits_overview.pdf",
      "meeting_notes.pdf",
      "policy_update.pdf"
    ];
    const phishNames = [
      "invoice_details.pdf.exe",
      "document_update.pdf.scr",
      "security_patch.pdf.bat",
      "payslip.pdf.exe",
      "urgent_update.exe"
    ];

    function randomFrom(list) {
      return list[Math.floor(Math.random() * list.length)];
    }

    for (const pairIndex of idxToAdd) {
      const [a, b] = pairs[pairIndex];

      // Attach safe-looking files to safe emails, bad-looking to phish emails
      if (a.correct === "safe") {
        a.attachment = randomFrom(safeNames);
      } else {
        a.attachment = randomFrom(phishNames);
      }

      if (b.correct === "safe") {
        b.attachment = randomFrom(safeNames);
      } else {
        b.attachment = randomFrom(phishNames);
      }
    }
  }

  return pairs;
}
// ---------------------------------------------------------------

async function askPairsBatch(count, topicsHint) {
  const sys = `You generate realistic corporate emails for a phishing training game.
Return ONLY a JSON array where EACH element is a PAIR object with this exact shape:
{
  "pair": [
    {
      "subject": "string",
      "from": "name@domain.tld",
      "to": ["employee@company.com"],
      "attachment": "string (optional, e.g. 'training.pdf' or 'training.pdf.exe')",
      "desc": "email body text",
      "correct": "phish" | "safe",
      "explain": "reason why"
    },
    {
      "subject": "string",
      "from": "name@domain.tld",
      "to": ["employee@company.com"],
      "attachment": "string (optional, e.g. 'training.pdf' or 'training.pdf.exe')",
      "desc": "email body text",
      "correct": "phish" | "safe",
      "explain": "reason why"
    }
  ]
}
Rules:
- Exactly ONE email in each pair must be "phish" and the other "safe".
- either both pairs in a group(Phish & safe) have attachments or both dont. 
- Vary departments (HR, Finance, IT, Facilities, Travel, Legal, Security, etc.) and both emails in a pair must be of the same theme, that is the phish and the real email must be of the same theme, so that the user can differentiate between a real and a phish clearly.
- Use human, office-like language with realistic details.
- Output pure JSON only (no code fences, no extra prose).`;

  const user = `Create ${count} PAIRS of corporate emails for training.${
    topicsHint ? ` Focus on: ${topicsHint}.` : ""
  }
For EACH email:
- Choose a random body length between ${MIN_WORDS} and ${MAX_WORDS} words (approx).
- Each email must be well formatted like a real email, well spaced, header, body, signature , all well spaced like a formal mail
- Include an "attachment" field in ~${ATTACHMENT_RATE}% of emails (overall), with realistic filenames.
  - Safe examples: "training.pdf", "report.pdf".
  - Phish examples: "training.pdf.exe", "invoice.pdf.exe/.src/.bat".
- Ensure each pair has ONE "phish" and ONE "safe". Return JSON array of { "pair": [emailA, emailB] } only.`;

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

  // NEW: enforce strict attachment percentage at the PAIR level
  pairs = enforceAttachmentRateOnPairs(pairs);

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
