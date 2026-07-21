#!/usr/bin/env bash
set -euo pipefail

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${CLOUD_ARMOR_POLICY:?CLOUD_ARMOR_POLICY is required}"
: "${CLOUD_ARMOR_BACKEND_SERVICES:?CLOUD_ARMOR_BACKEND_SERVICES is required}"

AUTH_RULE_PRIORITY=1000
CONTACT_RULE_PRIORITY=1010
AUTH_RULE_DESCRIPTION="smart-job-managed-auth-ip-throttle-v1"
CONTACT_RULE_DESCRIPTION="smart-job-managed-contact-ip-throttle-v1"
AUTH_EXPRESSION="request.method == 'POST' && (request.path.matches('^/api/auth/(login|register|forgot-password|reset-password)$') || request.path.matches('^/api/onboarding/(business-registration|invitation)$') || request.path.matches('^/api/v1/auth/(web-sessions|business-registration|invitations/redeem)$'))"
CONTACT_EXPRESSION="request.path.matches('^/api/contact/(challenge|request)$') || (request.method == 'POST' && request.path.matches('^/api/v1/contact-requests$'))"

if ! gcloud compute security-policies describe "${CLOUD_ARMOR_POLICY}" \
  --project="${GCP_PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute security-policies create "${CLOUD_ARMOR_POLICY}" \
    --project="${GCP_PROJECT_ID}" \
    --description="Smart-Job public edge policy" \
    --quiet
fi

upsert_throttle_rule() {
  local priority="$1"
  local description="$2"
  local expression="$3"
  local threshold_count="$4"
  local threshold_seconds="$5"
  local operation="create"
  local existing_description=""

  if existing_description="$(gcloud compute security-policies rules describe "${priority}" \
    --security-policy="${CLOUD_ARMOR_POLICY}" \
    --project="${GCP_PROJECT_ID}" \
    --format='value(description)' 2>/dev/null)"; then
    if [[ "${existing_description}" != "${description}" ]]; then
      echo "Refusing to replace unmanaged Cloud Armor rule at priority ${priority}" >&2
      exit 1
    fi
    operation="update"
  fi

  gcloud compute security-policies rules "${operation}" "${priority}" \
    --security-policy="${CLOUD_ARMOR_POLICY}" \
    --project="${GCP_PROJECT_ID}" \
    --description="${description}" \
    --expression="${expression}" \
    --action=throttle \
    --rate-limit-threshold-count="${threshold_count}" \
    --rate-limit-threshold-interval-sec="${threshold_seconds}" \
    --conform-action=allow \
    --exceed-action=deny-429 \
    --enforce-on-key=ip \
    --quiet
}

# Auth allows short legitimate bursts; contact is tighter because each normal
# submission consumes only one challenge request and one submit request.
upsert_throttle_rule "${AUTH_RULE_PRIORITY}" "${AUTH_RULE_DESCRIPTION}" "${AUTH_EXPRESSION}" 30 60
upsert_throttle_rule "${CONTACT_RULE_PRIORITY}" "${CONTACT_RULE_DESCRIPTION}" "${CONTACT_EXPRESSION}" 20 300

IFS=',' read -r -a backend_services <<< "${CLOUD_ARMOR_BACKEND_SERVICES}"
for backend_service in "${backend_services[@]}"; do
  backend_service="${backend_service#"${backend_service%%[![:space:]]*}"}"
  backend_service="${backend_service%"${backend_service##*[![:space:]]}"}"
  if [[ ! "${backend_service}" =~ ^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$ ]]; then
    echo "Invalid or empty backend service name in CLOUD_ARMOR_BACKEND_SERVICES" >&2
    exit 1
  fi
  gcloud compute backend-services update "${backend_service}" \
    --global \
    --security-policy="${CLOUD_ARMOR_POLICY}" \
    --project="${GCP_PROJECT_ID}" \
    --quiet
done

echo "Cloud Armor auth/contact throttles are configured and attached."
