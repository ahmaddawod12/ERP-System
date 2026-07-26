locals {
  labels = merge(var.labels, {
    application = "smart-job"
    environment = var.environment
    managed-by  = "terraform"
  })

  monitored_services = var.enable_runtime ? {
    for key, service_name in var.service_names : key => service_name
    if contains(["website", "api", "tax", "pdf", "email"], key)
  } : {}

  monitored_subscriptions = var.enable_runtime ? {
    for key, subscription_name in var.subscription_names : key => {
      name        = subscription_name
      dead_letter = endswith(key, "_dead_letter")
      threshold   = endswith(key, "_dead_letter") ? 0 : 100
      duration    = endswith(key, "_dead_letter") ? "0s" : "600s"
    }
  } : {}

  document_subscriptions = {
    for key, subscription in local.monitored_subscriptions : key => subscription
    if startswith(key, "document_")
  }
  email_subscriptions = {
    for key, subscription in local.monitored_subscriptions : key => subscription
    if startswith(key, "email_")
  }

  operational_metrics = var.enable_runtime ? {
    tax_submissions = {
      display_name  = "Tax submission failures"
      resource_type = "cloud_run_revision"
      filter = join(" AND ", [
        "resource.type=\"cloud_run_revision\"",
        "(resource.labels.service_name=\"${lookup(var.service_names, "api", "")}\" OR resource.labels.service_name=\"${lookup(var.service_names, "tax", "")}\")",
        "jsonPayload.taxSubmissionFailure=true",
      ])
      documentation = "Keep production tax disabled unless certified. Inspect the tax outbox and submission-unknown rows; never blindly retry an ambiguous authority request."
    }
    tax_callbacks = {
      display_name  = "Tax callback failures"
      resource_type = "cloud_run_revision"
      filter = join(" AND ", [
        "resource.type=\"cloud_run_revision\"",
        "(resource.labels.service_name=\"${lookup(var.service_names, "api", "")}\" OR resource.labels.service_name=\"${lookup(var.service_names, "tax", "")}\")",
        "jsonPayload.taxCallbackFailure=true",
      ])
      documentation = "Inspect the tax gateway and protected API callback logs by request ID. Preserve the callback payload and replay only through the idempotent callback path."
    }
    archive_failures = {
      display_name  = "Archive run failures"
      resource_type = "cloud_run_job"
      filter = join(" AND ", [
        "resource.type=\"cloud_run_job\"",
        "resource.labels.job_name=\"${lookup(var.job_names, "archiver", "")}\"",
        "jsonPayload.archiveFailure=true",
      ])
      documentation = "Inspect the leased archive run and immutable object metadata. Resume from the recorded lease/checksum state instead of starting an overlapping export."
    }
    backup_failures = {
      display_name  = "Recovery backup failures or RPO breaches"
      resource_type = "cloud_run_job"
      filter = join(" AND ", [
        "resource.type=\"cloud_run_job\"",
        "(resource.labels.job_name=\"${lookup(var.job_names, "backup-storage", "")}\" OR resource.labels.job_name=\"${lookup(var.job_names, "backup-database", "")}\")",
        "(jsonPayload.backupFailure=true OR jsonPayload.backupRpoBreached=true)",
      ])
      documentation = "Inspect the immutable backup manifest and checkpoint. Resume the Storage inventory or logical export; do not delete existing recovery objects or weaken checksum verification."
    }
    database_pool_saturation = {
      display_name  = "API database pool saturation"
      resource_type = "cloud_run_revision"
      filter = join(" AND ", [
        "resource.type=\"cloud_run_revision\"",
        "resource.labels.service_name=\"${lookup(var.service_names, "api", "")}\"",
        "jsonPayload.databasePoolSaturation=true",
      ])
      documentation = "Inspect API concurrency, pool waiters, and Supabase connection utilization. Do not raise pool limits without rechecking the Terraform 70-percent connection budget."
    }
    session_refresh_failures = {
      display_name  = "Opaque session refresh failures"
      resource_type = "cloud_run_revision"
      filter = join(" AND ", [
        "resource.type=\"cloud_run_revision\"",
        "resource.labels.service_name=\"${lookup(var.service_names, "api", "")}\"",
        "jsonPayload.sessionRefreshFailure=true",
      ])
      documentation = "Inspect Supabase Auth availability and the opaque-session refresh transaction. Never log or expose the encrypted access/refresh credentials."
    }
  } : {}
}

resource "google_monitoring_service" "cloud_run" {
  for_each = local.monitored_services

  project      = var.project_id
  service_id   = "${var.name_prefix}-${each.key}"
  display_name = "Smart-Job ${var.environment} ${each.key}"
  user_labels  = local.labels

  basic_service {
    service_type = "CLOUD_RUN"
    service_labels = {
      location     = var.service_locations[each.key]
      service_name = each.value
    }
  }
}

resource "google_monitoring_slo" "availability" {
  for_each = local.monitored_services

  project             = var.project_id
  service             = google_monitoring_service.cloud_run[each.key].service_id
  slo_id              = "availability-30d"
  display_name        = "99.9% successful requests over 30 days"
  goal                = var.slo_goal
  rolling_period_days = 30
  user_labels         = local.labels

  request_based_sli {
    good_total_ratio {
      good_service_filter = join(" AND ", [
        "metric.type=\"run.googleapis.com/request_count\"",
        "resource.type=\"cloud_run_revision\"",
        "resource.label.\"service_name\"=\"${each.value}\"",
        "metric.label.\"response_code_class\"!=\"5xx\"",
      ])
      total_service_filter = join(" AND ", [
        "metric.type=\"run.googleapis.com/request_count\"",
        "resource.type=\"cloud_run_revision\"",
        "resource.label.\"service_name\"=\"${each.value}\"",
      ])
    }
  }
}

resource "google_monitoring_alert_policy" "cloud_run_5xx" {
  for_each = local.monitored_services

  project               = var.project_id
  display_name          = "${var.environment} ${each.key}: elevated 5xx responses"
  combiner              = "OR"
  enabled               = true
  severity              = "ERROR"
  notification_channels = var.notification_channels
  user_labels           = local.labels

  conditions {
    display_name = "More than five 5xx responses in five minutes"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"run.googleapis.com/request_count\"",
        "resource.type=\"cloud_run_revision\"",
        "resource.label.\"service_name\"=\"${each.value}\"",
        "metric.label.\"response_code_class\"=\"5xx\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      duration        = "0s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close           = "1800s"
    notification_prompts = ["OPENED", "CLOSED"]
  }

  documentation {
    content   = "Inspect the affected revision and load-balancer logs. Pause traffic promotion or roll back to the previous signed digest when the candidate caused the errors."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "pubsub_backlog" {
  for_each = local.monitored_subscriptions

  project               = var.project_id
  display_name          = each.value.dead_letter ? "${var.environment} ${each.key}: dead-letter message" : "${var.environment} ${each.key}: durable queue backlog"
  combiner              = "OR"
  enabled               = true
  severity              = each.value.dead_letter ? "ERROR" : "WARNING"
  notification_channels = var.notification_channels
  user_labels           = local.labels

  conditions {
    display_name = each.value.dead_letter ? "At least one unacknowledged dead-letter message" : "More than 100 undelivered messages for ten minutes"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\"",
        "resource.type=\"pubsub_subscription\"",
        "resource.label.\"subscription_id\"=\"${each.value.name}\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = each.value.threshold
      duration        = each.value.duration

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MAX"
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close           = "3600s"
    notification_prompts = ["OPENED", "CLOSED"]
  }

  documentation {
    content   = each.value.dead_letter ? "Inspect the matching worker and delivery lease before acknowledging or replaying the retained DLQ message." : "Check worker health, delivery leases, and the matching dead-letter subscription before replaying messages."
    mime_type = "text/markdown"
  }
}

resource "google_logging_metric" "operational_failure" {
  for_each = local.operational_metrics

  project     = var.project_id
  name        = "${var.name_prefix}-${replace(each.key, "_", "-")}"
  description = each.value.display_name
  filter      = each.value.filter

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_monitoring_alert_policy" "operational_failure" {
  for_each = google_logging_metric.operational_failure

  project               = var.project_id
  display_name          = "${var.environment}: ${local.operational_metrics[each.key].display_name}"
  combiner              = "OR"
  enabled               = true
  severity              = "ERROR"
  notification_channels = var.notification_channels
  user_labels           = local.labels

  conditions {
    display_name = "At least one monitored failure in five minutes"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${each.value.name}\" AND resource.type=\"${local.operational_metrics[each.key].resource_type}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close           = "1800s"
    notification_prompts = ["OPENED", "CLOSED"]
  }

  documentation {
    content   = local.operational_metrics[each.key].documentation
    mime_type = "text/markdown"
  }
}

resource "google_logging_metric" "scheduler_failures" {
  count = var.enable_runtime ? 1 : 0

  project     = var.project_id
  name        = "${var.name_prefix}-scheduler-failures"
  description = "Failed Cloud Scheduler executions for Smart-Job"
  filter = join(" AND ", [
    "resource.type=\"cloud_scheduler_job\"",
    "resource.labels.job_id=~\"${var.name_prefix}.*\"",
    "severity>=ERROR",
  ])

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_monitoring_alert_policy" "scheduler_failures" {
  count = var.enable_runtime ? 1 : 0

  project               = var.project_id
  display_name          = "${var.environment}: scheduler execution failures"
  combiner              = "OR"
  enabled               = true
  severity              = "ERROR"
  notification_channels = var.notification_channels
  user_labels           = local.labels

  conditions {
    display_name = "At least one scheduler failure"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.scheduler_failures[0].name}\" AND resource.type=\"cloud_scheduler_job\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close           = "1800s"
    notification_prompts = ["OPENED", "CLOSED"]
  }
}

resource "google_monitoring_dashboard" "platform" {
  count = var.enable_runtime ? 1 : 0

  project = var.project_id
  dashboard_json = jsonencode({
    displayName = "Smart-Job ${var.environment} platform"
    labels      = local.labels
    mosaicLayout = {
      columns = 12
      tiles = [
        {
          xPos   = 0
          yPos   = 0
          width  = 6
          height = 4
          widget = {
            title = "Cloud Run request rate"
            xyChart = {
              dataSets = [{
                plotType   = "LINE"
                targetAxis = "Y1"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\""
                    aggregation = {
                      alignmentPeriod  = "60s"
                      perSeriesAligner = "ALIGN_RATE"
                    }
                  }
                }
              }]
              yAxis = { label = "requests/s", scale = "LINEAR" }
            }
          }
        },
        {
          xPos   = 6
          yPos   = 0
          width  = 6
          height = 4
          widget = {
            title = "Document queues and DLQs"
            xyChart = {
              dataSets = [for key, subscription in local.document_subscriptions : {
                plotType       = "STACKED_AREA"
                targetAxis     = "Y1"
                legendTemplate = key
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\" AND resource.type=\"pubsub_subscription\" AND resource.label.\"subscription_id\"=\"${subscription.name}\""
                    aggregation = {
                      alignmentPeriod  = "60s"
                      perSeriesAligner = "ALIGN_MAX"
                    }
                  }
                }
              }]
              yAxis = { label = "messages", scale = "LINEAR" }
            }
          }
        },
        {
          xPos   = 0
          yPos   = 4
          width  = 6
          height = 4
          widget = {
            title = "Email queue and DLQ"
            xyChart = {
              dataSets = [for key, subscription in local.email_subscriptions : {
                plotType       = "STACKED_AREA"
                targetAxis     = "Y1"
                legendTemplate = key
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\" AND resource.type=\"pubsub_subscription\" AND resource.label.\"subscription_id\"=\"${subscription.name}\""
                    aggregation = {
                      alignmentPeriod  = "60s"
                      perSeriesAligner = "ALIGN_MAX"
                    }
                  }
                }
              }]
              yAxis = { label = "messages", scale = "LINEAR" }
            }
          }
        },
        {
          xPos   = 6
          yPos   = 4
          width  = 6
          height = 4
          widget = {
            title = "Tax submission and callback failures"
            xyChart = {
              dataSets = [for key in ["tax_submissions", "tax_callbacks"] : {
                plotType       = "LINE"
                targetAxis     = "Y1"
                legendTemplate = local.operational_metrics[key].display_name
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.operational_failure[key].name}\" AND resource.type=\"cloud_run_revision\""
                    aggregation = {
                      alignmentPeriod  = "300s"
                      perSeriesAligner = "ALIGN_SUM"
                    }
                  }
                }
              }]
              yAxis = { label = "failures/5m", scale = "LINEAR" }
            }
          }
        },
        {
          xPos   = 0
          yPos   = 8
          width  = 6
          height = 4
          widget = {
            title = "Archive failures"
            xyChart = {
              dataSets = [{
                plotType   = "LINE"
                targetAxis = "Y1"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.operational_failure["archive_failures"].name}\" AND resource.type=\"cloud_run_job\""
                    aggregation = {
                      alignmentPeriod  = "300s"
                      perSeriesAligner = "ALIGN_SUM"
                    }
                  }
                }
              }]
              yAxis = { label = "failures/5m", scale = "LINEAR" }
            }
          }
        },
        {
          xPos   = 6
          yPos   = 8
          width  = 6
          height = 4
          widget = {
            title = "Database pool and session refresh failures"
            xyChart = {
              dataSets = [for key in ["database_pool_saturation", "session_refresh_failures"] : {
                plotType       = "LINE"
                targetAxis     = "Y1"
                legendTemplate = local.operational_metrics[key].display_name
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.operational_failure[key].name}\" AND resource.type=\"cloud_run_revision\""
                    aggregation = {
                      alignmentPeriod  = "300s"
                      perSeriesAligner = "ALIGN_SUM"
                    }
                  }
                }
              }]
              yAxis = { label = "events/5m", scale = "LINEAR" }
            }
          }
        },
        {
          xPos   = 0
          yPos   = 12
          width  = 6
          height = 4
          widget = {
            title = "Backup failures and RPO breaches"
            xyChart = {
              dataSets = [{
                plotType   = "LINE"
                targetAxis = "Y1"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.operational_failure["backup_failures"].name}\" AND resource.type=\"cloud_run_job\""
                    aggregation = {
                      alignmentPeriod  = "300s"
                      perSeriesAligner = "ALIGN_SUM"
                    }
                  }
                }
              }]
              yAxis = { label = "events/5m", scale = "LINEAR" }
            }
          }
        },
      ]
    }
  })
}
