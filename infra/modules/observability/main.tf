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
  for_each = var.enable_runtime ? var.subscription_names : {}

  project               = var.project_id
  display_name          = "${var.environment} ${each.key}: durable queue backlog"
  combiner              = "OR"
  enabled               = true
  severity              = "WARNING"
  notification_channels = var.notification_channels
  user_labels           = local.labels

  conditions {
    display_name = "More than 100 undelivered messages for ten minutes"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\"",
        "resource.type=\"pubsub_subscription\"",
        "resource.label.\"subscription_id\"=\"${each.value}\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = 100
      duration        = "600s"

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
    content   = "Check worker health, delivery leases, and the matching dead-letter topic before replaying messages."
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
          width  = 12
          height = 4
          widget = {
            title = "Cloud Run request rate"
            xyChart = {
              dataSets = [
                {
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
                }
              ]
              yAxis = {
                label = "requests/s"
                scale = "LINEAR"
              }
            }
          }
        },
        {
          xPos   = 0
          yPos   = 4
          width  = 12
          height = 4
          widget = {
            title = "Pub/Sub undelivered messages"
            xyChart = {
              dataSets = [
                {
                  plotType   = "STACKED_AREA"
                  targetAxis = "Y1"
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\" AND resource.type=\"pubsub_subscription\""
                      aggregation = {
                        alignmentPeriod  = "60s"
                        perSeriesAligner = "ALIGN_MAX"
                      }
                    }
                  }
                }
              ]
              yAxis = {
                label = "messages"
                scale = "LINEAR"
              }
            }
          }
        }
      ]
    }
  })
}
