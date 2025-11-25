// scripts/validate_email_pairs.mjs
// Validates final emails.json used by the quiz UI.

import fs from "fs";

const FILE = process.env.EMAIL_FILE || "emails.json";
const raw = fs.readFileSync(FILE, "utf8");
const data = JSON.parse(raw);

// optional soft constraints for body length
const MIN_WORDS = Number(process.env.MIN_WORDS || "0");   // e.g. 80
const MAX_WORDS = Number(process.env.MAX_WORDS || "0");   // e.g. 400

function wordCount(s) {
  if (!s) return 0;
  return String(s)
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function isEmail(o) {
  if (!o) return false;

  const hasSubject = typeof o.subject === "string" && o.subject.trim();
  const hasFrom = typeof o.from === "string" && o.from.trim();

  const hasToArray =
    Array.isArray(o.to) &&
    o.to.length > 0 &&
    o.to.every((s) => typeof s === "string" && s.trim());

  const hasToString = typeof o.to === "string" && o.to.trim();

  const body = (typeof o.desc === "string" && o.desc.trim())
    ? o.desc
    : (typeof o.body === "string" && o.body.trim() ? o.body : "");

  const hasBody = Boolean(body);

  const hasCorrect = o.correct === "phish" || o.correct === "safe";
  const hasExplain =
    typeof o.explain === "string" && o.explain.trim();

  const base =
    hasSubject &&
    hasFrom &&
    (hasToArray || hasToString) &&
    hasBody &&
    hasCorrect &&
    hasExplain;

  if (!base) return false;

  // attachment optional but must be string if present
  if (o.attachment !== undefined && o.attachment !== null && o.attachment !== "") {
    if (typeof o.attachment !== "string") return false;
  }

  return true;
}

const groupKeys = Object.keys(data).filter((k) =>
  /^email_group_\d+$/.test(k)
);

let ok = true;
const errs = [];
const warns = [];

for (const k of groupKeys) {
  const pair = data[k];

  if (!Array.isArray(pair) || pair.length !== 2) {
    ok = false;
    errs.push(`${k}: must be an array of exactly 2 emails`);
    continue;
  }

  const [a, b] = pair;
  if (!isEmail(a) || !isEmail(b)) {
    ok = false;
    errs.push(`${k}: email shape invalid (missing field or wrong type)`);
    continue;
  }

  const labels = [a.correct, b.correct].sort().join(",");
  if (labels !== "phish,safe") {
    ok = false;
    errs.push(`${k}: pair must contain exactly one "phish" and one "safe"`);
  }

  // --- soft checks (do not flip ok=false, just warn) ---

  const bodyA = a.desc || a.body || "";
  const bodyB = b.desc || b.body || "";
  const wcA = wordCount(bodyA);
  const wcB = wordCount(bodyB);

  if (MIN_WORDS && (wcA < MIN_WORDS || wcB < MIN_WORDS)) {
    warns.push(
      `${k}: body word-count below MIN_WORDS (${wcA}/${wcB}, min=${MIN_WORDS})`
    );
  }
  if (MAX_WORDS && (wcA > MAX_WORDS || wcB > MAX_WORDS)) {
    warns.push(
      `${k}: body word-count above MAX_WORDS (${wcA}/${wcB}, max=${MAX_WORDS})`
    );
  }

  // encourage multiline formatting usage
  if (!bodyA.includes("\n")) {
    warns.push(`${k}: first email has no newline characters in desc/body`);
  }
  if (!bodyB.includes("\n")) {
    warns.push(`${k}: second email has no newline characters in desc/body`);
  }
}

if (!ok) {
  console.error("Validation failed:\n" + errs.join("\n"));
  if (warns.length) {
    console.error("\nWarnings:\n" + warns.join("\n"));
  }
  process.exit(1);
} else {
  console.log(`Validation passed for ${groupKeys.length} groups in ${FILE}.`);
  if (warns.length) {
    console.log("\nWarnings:\n" + warns.join("\n"));
  }
}