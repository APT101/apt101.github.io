// scripts/validate_email_pairs.mjs
import fs from "fs";

const FILE = "emails.json";
const data = JSON.parse(fs.readFileSync(FILE, "utf8"));

function isEmail(o){
  if (!o) return false;
  const base =
    typeof o.subject === "string" && o.subject.trim() &&
    typeof o.from === "string" && o.from.trim() &&
    (
      (Array.isArray(o.to) && o.to.length && o.to.every(s => typeof s === "string" && s.trim())) ||
      (typeof o.to === "string" && o.to.trim())
    ) &&
    (
      (typeof o.desc === "string" && o.desc.trim()) ||
      (typeof o.body === "string" && o.body.trim())
    ) &&
    (o.correct === "phish" || o.correct === "safe") &&
    typeof o.explain === "string" && o.explain.trim();

  if (!base) return false;
  if (o.attachment !== undefined && o.attachment !== null && o.attachment !== "") {
    if (typeof o.attachment !== "string") return false;
  }
  return true;
}

const groupKeys = Object.keys(data).filter(k => /^email_group_\d+$/.test(k));
let ok = true, errs = [];

for (const k of groupKeys){
  const pair = data[k];
  if (!Array.isArray(pair) || pair.length !== 2){
    ok = false; errs.push(`${k}: must be an array of exactly 2 emails`); continue;
  }
  const [a,b] = pair;
  if (!isEmail(a) || !isEmail(b)){
    ok = false; errs.push(`${k}: email shape invalid (missing field or wrong type)`); continue;
  }
  const labels = [a.correct, b.correct].sort().join(",");
  if (labels !== "phish,safe"){
    ok = false; errs.push(`${k}: pair must contain exactly one "phish" and one "safe"`);
  }
}

if (!ok){
  console.error("Validation failed:\n" + errs.join("\n"));
  process.exit(1);
} else {
  console.log(`Validation passed for ${groupKeys.length} groups in ${FILE}.`);
}
