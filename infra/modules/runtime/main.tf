data "google_project" "current" {
  project_id = var.project_id
}

locals {
  labels = merge(var.labels, {
    application = "smart-job"
    environment = var.environment
    managed-by  = "terraform"
  })

  required_images = toset([
    "api",
    "archiver",
    "email",
    "migration",
    "pdf",
    "tax",
    "website",
  ])

  internal_api_audience = "https://api.internal.smart-job/${var.environment}"
  pdf_oidc_audience     = "https://pdf.internal.smart-job/${var.environment}"
  email_oidc_audience   = "https://email.internal.smart-job/${var.environment}"

  topics = {
    document_preview  = "${var.name_prefix}-document-preview"
    document_generate = "${var.name_prefix}-document-generate"
    email_delivery    = "${var.name_prefix}-email-delivery"
  }

  dead_letter_topics = {
    document_preview  = "${var.name_prefix}-document-preview-dlq"
    document_generate = "${var.name_prefix}-document-generate-dlq"
    email_delivery    = "${var.name_prefix}-email-delivery-dlq"
  }

  service_configs = {
    website = {
      location            = var.primary_region
      subnet              = var.primary_subnet_id
      service_account     = var.service_accounts["website"]
      image               = lookup(var.image_digests, "website", "")
      min_instances       = 1
      max_instances       = var.service_max_instances.website
      concurrency         = 80
      cpu                 = "1"
      memory              = "512Mi"
      ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
      disable_invoker_iam = true
      custom_audiences    = []
      health_path         = null
      env = {
        BACKEND_API_BASE_URL                      = var.api_origin
        BACKEND_API_TIMEOUT_MS                    = "12000"
        HOST                                      = "0.0.0.0"
        NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY = var.recaptcha_site_key
        NODE_ENV                                  = "production"
        PORT                                      = "8080"
        RECAPTCHA_ENTERPRISE_MIN_SCORE            = "0.7"
        RECAPTCHA_ENTERPRISE_PROJECT_ID           = var.project_id
        RECAPTCHA_ENTERPRISE_TIMEOUT_MS           = "8000"
        SUPABASE_AUTH_TIMEOUT_MS                  = "8000"
        WEBSITE_ORIGIN                            = var.website_origin
      }
      secret_env = {
        CONTACT_CHALLENGE_SECRET = var.secret_ids["contact_challenge_secret"]
        SUPABASE_PUBLISHABLE_KEY = var.secret_ids["supabase_publishable_key"]
        SUPABASE_URL             = var.secret_ids["supabase_url"]
        WEBSITE_SESSION_SECRET   = var.secret_ids["website_session_secret"]
      }
    }
    api = {
      location            = var.primary_region
      subnet              = var.primary_subnet_id
      service_account     = var.service_accounts["api"]
      image               = lookup(var.image_digests, "api", "")
      min_instances       = 1
      max_instances       = var.service_max_instances.api
      concurrency         = 40
      cpu                 = "1"
      memory              = "512Mi"
      ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
      disable_invoker_iam = true
      custom_audiences    = [local.internal_api_audience]
      health_path         = "/readyz"
      env = {
        ARCHIVE_BUCKET                     = var.archive_bucket_name
        DATABASE_CONNECT_TIMEOUT_MS        = "10000"
        DATABASE_IDLE_TIMEOUT_MS           = "30000"
        DATABASE_MAX_CONNECTIONS           = tostring(var.database_pool_max.api)
        DATABASE_SSL_MODE                  = "require"
        DATABASE_SSL_REJECT_UNAUTHORIZED   = "true"
        DOCUMENT_GENERATE_TOPIC            = local.topics.document_generate
        DOCUMENT_PREVIEW_TOPIC             = local.topics.document_preview
        DOCUMENT_PUBSUB_PROJECT_ID         = var.project_id
        EMAIL_DELIVERY_TOPIC               = local.topics.email_delivery
        HOST                               = "0.0.0.0"
        INTERNAL_API_AUDIENCE              = local.internal_api_audience
        INTERNAL_CALLER_SERVICE_ACCOUNTS   = join(",", [var.service_accounts["scheduler"], var.service_accounts["tax"]])
        LOG_LEVEL                          = "info"
        NODE_ENV                           = "production"
        PORT                               = "8080"
        REQUEST_TIMEOUT_MS                 = "12000"
        SUPABASE_JWT_AUDIENCE              = "authenticated"
        SUPABASE_STORAGE_BUCKET            = "smart-job-company-files"
        TAX_GATEWAY_TIMEOUT_MS             = "8000"
        TAX_SUBMISSION_MODE                = "disabled"
        WEB_SESSION_ENCRYPTION_KEY_VERSION = var.web_session_key_version
      }
      secret_env = {
        DATABASE_URL                      = var.secret_ids["api_database_url"]
        SUPABASE_PUBLISHABLE_KEY          = var.secret_ids["supabase_publishable_key"]
        SUPABASE_SECRET_KEY               = var.secret_ids["supabase_secret_key"]
        SUPABASE_URL                      = var.secret_ids["supabase_url"]
        WEB_SESSION_ENCRYPTION_KEY_BASE64 = var.secret_ids["web_session_encryption_key"]
      }
    }
    tax = {
      location            = var.tax_region
      subnet              = var.tax_subnet_id
      service_account     = var.service_accounts["tax"]
      image               = lookup(var.image_digests, "tax", "")
      min_instances       = 1
      max_instances       = var.service_max_instances.tax
      concurrency         = 40
      cpu                 = "1"
      memory              = "512Mi"
      ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
      disable_invoker_iam = true
      custom_audiences    = []
      health_path         = "/readyz"
      env = {
        HOST                    = "0.0.0.0"
        LOG_LEVEL               = "info"
        NODE_ENV                = "production"
        PORT                    = "8080"
        TAX_OUTBOUND_TIMEOUT_MS = "8000"
        TAX_SUBMISSION_MODE     = "disabled"
      }
      secret_env = {}
    }
    pdf = {
      location            = var.primary_region
      subnet              = var.primary_subnet_id
      service_account     = var.service_accounts["pdf"]
      image               = lookup(var.image_digests, "pdf", "")
      min_instances       = 0
      max_instances       = var.service_max_instances.pdf
      concurrency         = 2
      cpu                 = "2"
      memory              = "2Gi"
      ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
      disable_invoker_iam = false
      custom_audiences    = [local.pdf_oidc_audience]
      health_path         = "/health"
      env = {
        CLOUD_RUN_SERVICE_URL                  = local.pdf_oidc_audience
        DATABASE_MAX_CONNECTIONS               = tostring(var.database_pool_max.pdf)
        DATABASE_SSL_MODE                      = "require"
        DOCUMENT_TASK_PROCESSING_LEASE_SECONDS = "300"
        JSON_BODY_LIMIT                        = "1mb"
        MAX_CONCURRENT_TABS                    = "2"
        MAX_TAB_WAITERS                        = "64"
        NODE_ENV                               = "production"
        PORT                                   = "8080"
        PUBSUB_ALLOWED_SERVICE_ACCOUNTS        = var.service_accounts["pubsub-push"]
        PUPPETEER_EXECUTABLE_PATH              = "/usr/bin/google-chrome-stable"
        SHUTDOWN_TIMEOUT_MS                    = "30000"
        SMART_JOB_PERSISTENCE_BACKEND          = "sql"
        SUPABASE_STORAGE_BUCKET                = "smart-job-company-files"
        TAB_WAIT_TIMEOUT_MS                    = "10000"
      }
      secret_env = {
        DATABASE_URL        = var.secret_ids["pdf_database_url"]
        SUPABASE_SECRET_KEY = var.secret_ids["supabase_secret_key"]
        SUPABASE_URL        = var.secret_ids["supabase_url"]
      }
    }
    email = {
      location            = var.primary_region
      subnet              = var.primary_subnet_id
      service_account     = var.service_accounts["email"]
      image               = lookup(var.image_digests, "email", "")
      min_instances       = 0
      max_instances       = var.service_max_instances.email
      concurrency         = 20
      cpu                 = "1"
      memory              = "512Mi"
      ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
      disable_invoker_iam = false
      custom_audiences    = [local.email_oidc_audience]
      health_path         = "/health"
      env = {
        AWS_REGION                      = "eu-central-1"
        CLOUD_RUN_SERVICE_URL           = local.email_oidc_audience
        DATABASE_MAX_CONNECTIONS        = tostring(var.database_pool_max.email)
        DATABASE_SSL_MODE               = "require"
        EMAIL_SEND_LEASE_SECONDS        = "60"
        NODE_ENV                        = "production"
        PORT                            = "8080"
        PUBSUB_ALLOWED_SERVICE_ACCOUNTS = var.service_accounts["pubsub-push"]
        SES_FROM_NAME                   = "Smart-Job"
        SIGNED_DOWNLOAD_TTL_SECONDS     = "86400"
        SUPABASE_STORAGE_BUCKET         = "smart-job-company-files"
      }
      secret_env = {
        AWS_ACCESS_KEY_ID     = var.secret_ids["aws_access_key_id"]
        AWS_SECRET_ACCESS_KEY = var.secret_ids["aws_secret_access_key"]
        DATABASE_URL          = var.secret_ids["email_database_url"]
        SES_FROM_EMAIL        = var.secret_ids["ses_from_email"]
        SUPABASE_SECRET_KEY   = var.secret_ids["supabase_secret_key"]
        SUPABASE_URL          = var.secret_ids["supabase_url"]
      }
    }
  }

  job_configs = {
    archiver = {
      location        = var.primary_region
      subnet          = var.primary_subnet_id
      service_account = var.service_accounts["archiver"]
      image           = lookup(var.image_digests, "archiver", "")
      max_retries     = 2
      timeout         = "3600s"
      cpu             = "1"
      memory          = "1Gi"
      command         = []
      args            = []
      env = {
        ARCHIVER_CANDIDATE_LIMIT       = "2000"
        ARCHIVER_COMPANY_CONCURRENCY   = "2"
        ARCHIVER_JOB_DEADLINE_MS       = "3300000"
        ARCHIVER_LEASE_SECONDS         = "3600"
        ARCHIVER_QUERY_PAGE_SIZE       = "500"
        ARCHIVE_BUCKET                 = var.archive_bucket_name
        DATABASE_MAX_CONNECTIONS       = tostring(var.database_pool_max.archiver)
        DATABASE_SSL_MODE              = "require"
        SMART_JOB_PERSISTENCE_BACKEND  = "sql"
        UPLOAD_CLEANUP_BATCH_SIZE      = "25"
        UPLOAD_CLEANUP_CONCURRENCY     = "4"
        UPLOAD_CLEANUP_HTTP_TIMEOUT_MS = "10000"
        UPLOAD_CLEANUP_LEASE_SECONDS   = "300"
      }
      secret_env = {
        DATABASE_URL        = var.secret_ids["archiver_database_url"]
        SUPABASE_SECRET_KEY = var.secret_ids["supabase_secret_key"]
        SUPABASE_URL        = var.secret_ids["supabase_url"]
      }
    }
    migration = {
      location        = var.primary_region
      subnet          = var.primary_subnet_id
      service_account = var.service_accounts["migrator"]
      image           = lookup(var.image_digests, "migration", "")
      max_retries     = 0
      timeout         = "900s"
      cpu             = "1"
      memory          = "512Mi"
      command         = []
      args            = []
      env = {
        DATABASE_MAX_CONNECTIONS         = tostring(var.database_pool_max.migration)
        DATABASE_SSL_MODE                = "require"
        DATABASE_SSL_REJECT_UNAUTHORIZED = "true"
      }
      secret_env = {
        DATABASE_URL = var.secret_ids["migrator_database_url"]
      }
    }
    smoke = {
      location        = var.primary_region
      subnet          = var.primary_subnet_id
      service_account = var.service_accounts["smoke"]
      image           = lookup(var.image_digests, "migration", "")
      max_retries     = 0
      timeout         = "300s"
      cpu             = "1"
      memory          = "256Mi"
      command         = ["node"]
      args            = ["/workspace/packages/db/smoke.mjs"]
      env = {
        SMOKE_TARGETS = "[]"
      }
      secret_env = {}
    }
  }

  active_job_configs = var.enable_runtime ? local.job_configs : (
    var.enable_release_jobs ? {
      for key, config in local.job_configs : key => config
      if contains(["migration", "smoke"], key)
    } : {}
  )

  database_connection_budget = (
    var.service_max_instances.api * var.database_pool_max.api
    + var.service_max_instances.pdf * var.database_pool_max.pdf
    + var.service_max_instances.email * var.database_pool_max.email
    + var.database_pool_max.archiver
    + var.database_pool_max.migration
  )

  required_secret_ids = toset(concat(
    flatten([for config in values(local.service_configs) : values(config.secret_env)]),
    flatten([for config in values(local.job_configs) : values(config.secret_env)]),
  ))
}

resource "terraform_data" "deployment_preconditions" {
  input = {
    database_connection_budget = local.database_connection_budget
    runtime_enabled            = var.enable_runtime
  }

  lifecycle {
    precondition {
      condition = !var.enable_runtime || alltrue([
        for image in local.required_images : contains(keys(var.image_digests), image)
      ])
      error_message = "Runtime enablement requires all seven signed image digests."
    }

    precondition {
      condition     = !var.enable_release_jobs || contains(keys(var.image_digests), "migration")
      error_message = "Release-job bootstrap requires the signed migration image digest."
    }

    precondition {
      condition = (!var.enable_runtime && !var.enable_release_jobs) || alltrue([
        for image in values(var.image_digests) : startswith(image, var.image_registry_prefix)
      ])
      error_message = "Every workload image must come from this environment's Artifact Registry repository."
    }

    precondition {
      condition     = local.database_connection_budget <= floor(var.supabase_connection_limit * 0.70)
      error_message = "Aggregate maximum database pools exceed 70% of the Supabase connection limit."
    }

    precondition {
      condition = !var.enable_release_jobs || contains(
        keys(var.secret_versions),
        var.secret_ids["migrator_database_url"],
      )
      error_message = "Release-job bootstrap requires a numbered migrator secret version."
    }

    precondition {
      condition = !var.enable_runtime || alltrue([
        for origin in [var.website_origin, var.api_origin, var.tax_origin] :
        can(regex("^https://[^/]+$", origin))
      ])
      error_message = "Public origins must be exact HTTPS origins without paths or trailing slashes."
    }

    precondition {
      condition     = !var.enable_runtime || trimspace(var.recaptcha_site_key) != ""
      error_message = "recaptcha_site_key is required before enabling runtime resources."
    }

    precondition {
      condition = !var.enable_runtime || alltrue([
        for secret_id in local.required_secret_ids : contains(keys(var.secret_versions), secret_id)
      ])
      error_message = "Runtime enablement requires a numbered version for every mounted secret."
    }
  }
}

resource "google_cloud_run_v2_service" "service" {
  for_each = var.enable_runtime ? local.service_configs : {}

  project              = var.project_id
  name                 = "${var.name_prefix}-${each.key}"
  location             = each.value.location
  ingress              = each.value.ingress
  invoker_iam_disabled = each.value.disable_invoker_iam
  custom_audiences     = each.value.custom_audiences
  deletion_protection  = var.environment == "prod"
  labels               = local.labels

  scaling {
    min_instance_count = each.value.min_instances
    max_instance_count = each.value.max_instances
  }

  template {
    service_account                  = each.value.service_account
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    timeout                          = "60s"
    max_instance_request_concurrency = each.value.concurrency
    labels                           = local.labels

    containers {
      name  = "app"
      image = each.value.image

      ports {
        name           = "http1"
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = each.value.cpu
          memory = each.value.memory
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = each.value.env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = each.value.secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = lookup(var.secret_versions, env.value, "")
            }
          }
        }
      }

      startup_probe {
        failure_threshold     = 12
        initial_delay_seconds = 0
        period_seconds        = 5
        timeout_seconds       = 3

        dynamic "http_get" {
          for_each = each.value.health_path == null ? [] : [each.value.health_path]
          content {
            path = http_get.value
            port = 8080
          }
        }

        dynamic "tcp_socket" {
          for_each = each.value.health_path == null ? [8080] : []
          content {
            port = tcp_socket.value
          }
        }
      }

      dynamic "readiness_probe" {
        for_each = each.value.health_path == null ? [] : [each.value.health_path]
        content {
          failure_threshold = 3
          period_seconds    = 5
          timeout_seconds   = 3

          http_get {
            path = readiness_probe.value
            port = 8080
          }
        }
      }
    }

    vpc_access {
      egress = "ALL_TRAFFIC"

      network_interfaces {
        network    = var.network_id
        subnetwork = each.value.subnet
        tags       = ["${var.name_prefix}-cloud-run"]
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      traffic,
    ]
  }

  depends_on = [terraform_data.deployment_preconditions]
}

resource "google_cloud_run_v2_job" "job" {
  for_each = local.active_job_configs

  project             = var.project_id
  name                = "${var.name_prefix}-${each.key}"
  location            = each.value.location
  deletion_protection = var.environment == "prod"
  labels              = local.labels

  template {
    task_count  = 1
    parallelism = 1
    labels      = local.labels

    template {
      service_account       = each.value.service_account
      execution_environment = "EXECUTION_ENVIRONMENT_GEN2"
      max_retries           = each.value.max_retries
      timeout               = each.value.timeout

      containers {
        name    = "task"
        image   = each.value.image
        command = length(each.value.command) == 0 ? null : each.value.command
        args    = length(each.value.args) == 0 ? null : each.value.args

        resources {
          limits = {
            cpu    = each.value.cpu
            memory = each.value.memory
          }
        }

        dynamic "env" {
          for_each = each.value.env
          content {
            name  = env.key
            value = env.value
          }
        }

        dynamic "env" {
          for_each = each.value.secret_env
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = env.value
                version = lookup(var.secret_versions, env.value, "")
              }
            }
          }
        }
      }

      vpc_access {
        egress = "ALL_TRAFFIC"

        network_interfaces {
          network    = var.network_id
          subnetwork = each.value.subnet
          tags       = ["${var.name_prefix}-cloud-run-job"]
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image]
  }

  depends_on = [terraform_data.deployment_preconditions]
}

resource "google_pubsub_topic" "task" {
  for_each = var.enable_runtime ? local.topics : {}

  project = var.project_id
  name    = each.value
  labels  = local.labels

  message_retention_duration = "604800s"
}

resource "google_pubsub_topic" "dead_letter" {
  for_each = var.enable_runtime ? local.dead_letter_topics : {}

  project = var.project_id
  name    = each.value
  labels  = local.labels

  message_retention_duration = "1209600s"
}

resource "google_service_account_iam_member" "pubsub_token_creator" {
  count = var.enable_runtime ? 1 : 0

  service_account_id = "projects/${var.project_id}/serviceAccounts/${var.service_accounts["pubsub-push"]}"
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_topic_iam_member" "api_publish" {
  for_each = var.enable_runtime ? google_pubsub_topic.task : {}

  project = var.project_id
  topic   = each.value.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${var.service_accounts["api"]}"
}

resource "google_pubsub_topic_iam_member" "dead_letter_publish" {
  for_each = var.enable_runtime ? google_pubsub_topic.dead_letter : {}

  project = var.project_id
  topic   = each.value.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_cloud_run_v2_service_iam_member" "push_invoker" {
  for_each = var.enable_runtime ? toset(["pdf", "email"]) : toset([])

  project  = var.project_id
  location = google_cloud_run_v2_service.service[each.value].location
  name     = google_cloud_run_v2_service.service[each.value].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.service_accounts["pubsub-push"]}"
}

resource "google_cloud_run_v2_service_iam_member" "smoke_invoker" {
  for_each = var.enable_runtime ? google_cloud_run_v2_service.service : {}

  project  = var.project_id
  location = each.value.location
  name     = each.value.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.service_accounts["smoke"]}"
}

resource "google_pubsub_subscription" "push" {
  for_each = var.enable_runtime ? {
    document_preview = {
      endpoint = "${google_cloud_run_v2_service.service["pdf"].uri}/preview"
      audience = local.pdf_oidc_audience
    }
    document_generate = {
      endpoint = "${google_cloud_run_v2_service.service["pdf"].uri}/generate"
      audience = local.pdf_oidc_audience
    }
    email_delivery = {
      endpoint = "${google_cloud_run_v2_service.service["email"].uri}/deliver"
      audience = local.email_oidc_audience
    }
  } : {}

  project                    = var.project_id
  name                       = "${local.topics[each.key]}-push"
  topic                      = google_pubsub_topic.task[each.key].id
  ack_deadline_seconds       = 600
  message_retention_duration = "604800s"
  labels                     = local.labels

  push_config {
    push_endpoint = each.value.endpoint

    oidc_token {
      service_account_email = var.service_accounts["pubsub-push"]
      audience              = each.value.audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter[each.key].id
    max_delivery_attempts = 10
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  depends_on = [
    google_cloud_run_v2_service_iam_member.push_invoker,
    google_pubsub_topic_iam_member.dead_letter_publish,
    google_service_account_iam_member.pubsub_token_creator,
  ]
}

resource "google_pubsub_subscription" "dead_letter" {
  for_each = var.enable_runtime ? google_pubsub_topic.dead_letter : {}

  project                    = var.project_id
  name                       = "${each.value.name}-inspect"
  topic                      = each.value.id
  ack_deadline_seconds       = 60
  message_retention_duration = "1209600s"
  retain_acked_messages      = true
  labels                     = local.labels

  expiration_policy {
    ttl = ""
  }
}

resource "google_pubsub_subscription_iam_member" "dead_letter_subscriber" {
  for_each = var.enable_runtime ? google_pubsub_subscription.push : {}

  project      = var.project_id
  subscription = each.value.name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_cloud_scheduler_job" "api_drain" {
  for_each = var.enable_runtime ? {
    document = {
      schedule = var.document_drain_schedule
      path     = "/internal/v1/document-dispatch/drain"
      body     = jsonencode({ limit = 100 })
      paused   = false
    }
    email = {
      schedule = var.email_drain_schedule
      path     = "/internal/v1/email-dispatch/drain"
      body     = jsonencode({ limit = 100 })
      paused   = false
    }
    tax = {
      schedule = var.tax_drain_schedule
      path     = "/internal/v1/tax-submissions/drain"
      body     = jsonencode({ limit = 10 })
      paused   = true
    }
  } : {}

  project     = var.project_id
  region      = var.primary_region
  name        = "${var.name_prefix}-${each.key}-drain"
  description = "Bounded ${each.key} outbox drain"
  schedule    = each.value.schedule
  time_zone   = "Etc/UTC"
  paused      = each.value.paused

  retry_config {
    retry_count          = 3
    max_retry_duration   = "300s"
    min_backoff_duration = "10s"
    max_backoff_duration = "60s"
    max_doublings        = 2
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.service["api"].uri}${each.value.path}"
    body        = base64encode(each.value.body)
    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = var.service_accounts["scheduler"]
      audience              = local.internal_api_audience
    }
  }
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_archiver" {
  count = var.enable_runtime ? 1 : 0

  project  = var.project_id
  location = google_cloud_run_v2_job.job["archiver"].location
  name     = google_cloud_run_v2_job.job["archiver"].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.service_accounts["scheduler"]}"
}

resource "google_cloud_scheduler_job" "archive" {
  count = var.enable_runtime ? 1 : 0

  project     = var.project_id
  region      = var.primary_region
  name        = "${var.name_prefix}-monthly-archive"
  description = "Invoke the leased single-task monthly archive job"
  schedule    = var.archive_schedule
  time_zone   = "Etc/UTC"

  retry_config {
    retry_count          = 1
    max_retry_duration   = "3600s"
    min_backoff_duration = "60s"
    max_backoff_duration = "300s"
    max_doublings        = 2
  }

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.primary_region}/jobs/${google_cloud_run_v2_job.job["archiver"].name}:run"

    oauth_token {
      service_account_email = var.service_accounts["scheduler"]
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [google_cloud_run_v2_job_iam_member.scheduler_archiver]
}
