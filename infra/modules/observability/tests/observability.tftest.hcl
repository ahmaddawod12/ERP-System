mock_provider "google" {}

variables {
  project_id     = "smart-job-test"
  environment    = "dev"
  name_prefix    = "smart-job-test"
  enable_runtime = false

  service_names = {
    website = "smart-job-test-website"
    api     = "smart-job-test-api"
    tax     = "smart-job-test-tax"
    pdf     = "smart-job-test-pdf"
    email   = "smart-job-test-email"
  }
  service_locations = {
    website = "europe-west3"
    api     = "europe-west3"
    tax     = "me-west1"
    pdf     = "europe-west3"
    email   = "europe-west3"
  }
  subscription_names = {
    document_preview              = "smart-job-test-document-preview-push"
    document_preview_dead_letter  = "smart-job-test-document-preview-dlq-inspect"
    document_generate             = "smart-job-test-document-generate-push"
    document_generate_dead_letter = "smart-job-test-document-generate-dlq-inspect"
    email_delivery                = "smart-job-test-email-delivery-push"
    email_delivery_dead_letter    = "smart-job-test-email-delivery-dlq-inspect"
  }
  job_names = {
    archiver = "smart-job-test-archiver"
  }
}

run "disabled_runtime_has_no_monitoring_resources" {
  command = plan

  assert {
    condition     = length(google_logging_metric.operational_failure) == 0
    error_message = "Foundation-only plans must not create runtime metrics."
  }
}

run "operational_gates_have_metrics_alerts_and_dashboard_tiles" {
  command = plan

  variables {
    enable_runtime = true
  }

  assert {
    condition     = length(google_logging_metric.operational_failure) == 5
    error_message = "Tax, callback, archive, database-pool, and session-refresh failures each require a log metric."
  }

  assert {
    condition     = length(google_monitoring_alert_policy.pubsub_backlog) == 6
    error_message = "Primary document/email queues and all DLQ inspection subscriptions require backlog alerts."
  }

  assert {
    condition     = google_monitoring_alert_policy.pubsub_backlog["email_delivery_dead_letter"].conditions[0].condition_threshold[0].threshold_value == 0
    error_message = "A single dead-lettered email must trigger the DLQ alert."
  }

  assert {
    condition     = strcontains(google_logging_metric.operational_failure["database_pool_saturation"].filter, "jsonPayload.databasePoolSaturation=true")
    error_message = "Database pool saturation must use the stable structured event field."
  }

  assert {
    condition     = strcontains(google_monitoring_dashboard.platform[0].dashboard_json, "Database pool and session refresh failures")
    error_message = "The platform dashboard must expose database-pool and session-refresh failures."
  }
}
