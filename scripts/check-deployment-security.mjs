import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/cloudrun-deploy.yml", "utf8");
const armor = readFileSync("scripts/configure-cloud-armor.sh", "utf8");

function requireMatch(source, expression, message) {
  if (!expression.test(source)) throw new Error(message);
}

requireMatch(workflow, /configure-cloud-armor\.sh/, "Production deployment must configure Cloud Armor");
requireMatch(workflow, /--ingress=internal-and-cloud-load-balancing/, "Production API must reject direct internet ingress");
requireMatch(workflow, /--tasks 1[\s\S]*--task-timeout 60m[\s\S]*--max-retries 2/, "Archiver must deploy as one 60-minute task with two retries");
requireMatch(workflow, /ARCHIVER_QUERY_PAGE_SIZE=500/, "Archiver deployment must retain its page bound");
requireMatch(workflow, /ARCHIVER_JOB_DEADLINE_MS=3300000/, "Archiver must stop before the platform timeout");
requireMatch(workflow, /ARCHIVER_CANDIDATE_LIMIT=2000/, "Archiver historical-period discovery must remain bounded");
requireMatch(armor, /--action=throttle/, "Cloud Armor rules must throttle rather than redirect");
requireMatch(armor, /--exceed-action=deny-429/, "Cloud Armor excess requests must receive HTTP 429");
requireMatch(armor, /--enforce-on-key=ip/, "Cloud Armor limits must be keyed by client IP");
requireMatch(armor, /api\/auth[\s\S]*api\/v1\/auth/, "Cloud Armor must cover website and API auth routes");
requireMatch(armor, /api\/onboarding\/\(business-registration\|invitation\)/, "Cloud Armor must cover website onboarding auth routes");
requireMatch(armor, /api\/contact[\s\S]*api\/v1\/contact-requests/, "Cloud Armor must cover website and API contact routes");
requireMatch(armor, /Refusing to replace unmanaged Cloud Armor rule/, "The policy script must preserve unmanaged rules");

process.stdout.write("Deployment security safeguards passed.\n");
