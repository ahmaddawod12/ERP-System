locals {
  labels = merge(var.labels, {
    application = "smart-job"
    environment = var.environment
    managed-by  = "terraform"
  })

  required_services = toset([
    "artifactregistry.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudtrace.googleapis.com",
    "clouderrorreporting.googleapis.com",
    "compute.googleapis.com",
    "dns.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "pubsub.googleapis.com",
    "recaptchaenterprise.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "sts.googleapis.com",
    "storage.googleapis.com",
  ])

  service_account_ids = toset([
    "deploy",
    "website",
    "api",
    "tax",
    "pdf",
    "email",
    "archiver",
    "migrator",
    "scheduler",
    "smoke",
    "pubsub-push",
  ])

  secret_ids = {
    api_database_url            = "${var.name_prefix}-api-database-url"
    archiver_database_url       = "${var.name_prefix}-archiver-database-url"
    aws_access_key_id           = "${var.name_prefix}-aws-access-key-id"
    aws_secret_access_key       = "${var.name_prefix}-aws-secret-access-key"
    contact_challenge_secret    = "${var.name_prefix}-contact-challenge-secret"
    email_database_url          = "${var.name_prefix}-email-database-url"
    migrator_database_url       = "${var.name_prefix}-migrator-database-url"
    pdf_database_url            = "${var.name_prefix}-pdf-database-url"
    ses_from_email              = "${var.name_prefix}-ses-from-email"
    supabase_publishable_key    = "${var.name_prefix}-supabase-publishable-key"
    supabase_secret_key         = "${var.name_prefix}-supabase-secret-key"
    supabase_url                = "${var.name_prefix}-supabase-url"
    tax_authority_approval_url  = "${var.name_prefix}-tax-authority-approval-url"
    tax_authority_client_id     = "${var.name_prefix}-tax-authority-client-id"
    tax_authority_client_secret = "${var.name_prefix}-tax-authority-client-secret"
    tax_authority_token_url     = "${var.name_prefix}-tax-authority-token-url"
    tax_callback_hmac_secret    = "${var.name_prefix}-tax-callback-hmac-secret"
    web_session_encryption_key  = "${var.name_prefix}-web-session-encryption-key"
    website_session_secret      = "${var.name_prefix}-website-session-secret"
  }

  secret_accessors = {
    website = toset([
      "contact_challenge_secret",
      "supabase_publishable_key",
      "supabase_url",
      "website_session_secret",
    ])
    api = toset([
      "api_database_url",
      "supabase_publishable_key",
      "supabase_secret_key",
      "supabase_url",
      "web_session_encryption_key",
    ])
    pdf = toset([
      "pdf_database_url",
      "supabase_secret_key",
      "supabase_url",
    ])
    email = toset([
      "aws_access_key_id",
      "aws_secret_access_key",
      "email_database_url",
      "ses_from_email",
      "supabase_secret_key",
      "supabase_url",
    ])
    archiver = toset([
      "archiver_database_url",
      "supabase_secret_key",
      "supabase_url",
    ])
    migrator = toset(["migrator_database_url"])
  }

  secret_access_bindings = flatten([
    for service, secrets in local.secret_accessors : [
      for secret in secrets : {
        key     = "${service}:${secret}"
        service = service
        secret  = secret
      }
    ]
  ])

  act_as_service_accounts = setsubtract(local.service_account_ids, toset(["deploy"]))
  telemetry_service_accounts = toset([
    "website",
    "api",
    "tax",
    "pdf",
    "email",
    "archiver",
    "migrator",
    "smoke",
  ])
}

resource "google_project_service" "required" {
  for_each = local.required_services

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "release" {
  project       = var.project_id
  location      = var.primary_region
  repository_id = var.artifact_repository_id
  description   = "Signed Smart-Job release images"
  format        = "DOCKER"
  labels        = local.labels

  docker_config {
    immutable_tags = true
  }

  depends_on = [google_project_service.required]
}

resource "google_artifact_registry_repository_iam_member" "external_release_readers" {
  for_each = var.artifact_registry_reader_members

  project    = var.project_id
  location   = google_artifact_registry_repository.release.location
  repository = google_artifact_registry_repository.release.name
  role       = "roles/artifactregistry.reader"
  member     = each.value
}

resource "google_compute_network" "platform" {
  project                 = var.project_id
  name                    = "${var.name_prefix}-network"
  auto_create_subnetworks = false
  routing_mode            = "GLOBAL"

  depends_on = [google_project_service.required]
}

resource "google_compute_subnetwork" "primary" {
  project                  = var.project_id
  name                     = "${var.name_prefix}-primary"
  region                   = var.primary_region
  network                  = google_compute_network.platform.id
  ip_cidr_range            = var.primary_subnet_cidr
  private_ip_google_access = true
}

resource "google_compute_subnetwork" "tax" {
  project                  = var.project_id
  name                     = "${var.name_prefix}-tax"
  region                   = var.tax_region
  network                  = google_compute_network.platform.id
  ip_cidr_range            = var.tax_subnet_cidr
  private_ip_google_access = true
}

resource "google_compute_address" "primary_egress" {
  project      = var.project_id
  name         = "${var.name_prefix}-primary-egress"
  region       = var.primary_region
  address_type = "EXTERNAL"
  network_tier = "PREMIUM"
}

resource "google_compute_address" "tax_egress" {
  project      = var.project_id
  name         = "${var.name_prefix}-tax-egress"
  region       = var.tax_region
  address_type = "EXTERNAL"
  network_tier = "PREMIUM"
}

resource "google_compute_router" "primary" {
  project = var.project_id
  name    = "${var.name_prefix}-primary-router"
  region  = var.primary_region
  network = google_compute_network.platform.id
}

resource "google_compute_router" "tax" {
  project = var.project_id
  name    = "${var.name_prefix}-tax-router"
  region  = var.tax_region
  network = google_compute_network.platform.id
}

resource "google_compute_router_nat" "primary" {
  project                            = var.project_id
  name                               = "${var.name_prefix}-primary-nat"
  region                             = var.primary_region
  router                             = google_compute_router.primary.name
  nat_ip_allocate_option             = "MANUAL_ONLY"
  nat_ips                            = [google_compute_address.primary_egress.self_link]
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"

  subnetwork {
    name                    = google_compute_subnetwork.primary.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

resource "google_compute_router_nat" "tax" {
  project                            = var.project_id
  name                               = "${var.name_prefix}-tax-nat"
  region                             = var.tax_region
  router                             = google_compute_router.tax.name
  nat_ip_allocate_option             = "MANUAL_ONLY"
  nat_ips                            = [google_compute_address.tax_egress.self_link]
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"

  subnetwork {
    name                    = google_compute_subnetwork.tax.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

resource "google_service_account" "platform" {
  for_each = local.service_account_ids

  project      = var.project_id
  account_id   = "${var.name_prefix}-${each.value}"
  display_name = "Smart-Job ${var.environment} ${each.value}"

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "runtime" {
  for_each = local.secret_ids

  project             = var.project_id
  secret_id           = each.value
  labels              = local.labels
  deletion_protection = var.environment == "prod"

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "runtime_access" {
  for_each = { for binding in local.secret_access_bindings : binding.key => binding }

  project   = var.project_id
  secret_id = google_secret_manager_secret.runtime[each.value.secret].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.platform[each.value.service].email}"
}

resource "google_storage_bucket" "archive" {
  project                     = var.project_id
  name                        = var.archive_bucket_name
  location                    = var.primary_region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels

  versioning {
    enabled = true
  }

  retention_policy {
    retention_period = var.archive_retention_days * 86400
    is_locked        = false
  }

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket" "backup" {
  project                     = var.project_id
  name                        = var.backup_bucket_name
  location                    = var.primary_region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels

  versioning {
    enabled = true
  }

  retention_policy {
    retention_period = var.backup_retention_days * 86400
    is_locked        = false
  }

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket_iam_member" "archiver_object_create" {
  bucket = google_storage_bucket.archive.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.platform["archiver"].email}"
}

resource "google_storage_bucket_iam_member" "archiver_object_verify" {
  bucket = google_storage_bucket.archive.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.platform["archiver"].email}"
}

resource "google_storage_bucket_iam_member" "api_archive_reads" {
  bucket = google_storage_bucket.archive.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.platform["api"].email}"
}

resource "google_project_iam_member" "runtime_log_writer" {
  for_each = local.telemetry_service_accounts

  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.platform[each.value].email}"
}

resource "google_project_iam_member" "runtime_metric_writer" {
  for_each = local.telemetry_service_accounts

  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.platform[each.value].email}"
}

resource "google_project_iam_member" "runtime_trace_agent" {
  for_each = local.telemetry_service_accounts

  project = var.project_id
  role    = "roles/cloudtrace.agent"
  member  = "serviceAccount:${google_service_account.platform[each.value].email}"
}

resource "google_project_iam_member" "runtime_error_writer" {
  for_each = local.telemetry_service_accounts

  project = var.project_id
  role    = "roles/errorreporting.writer"
  member  = "serviceAccount:${google_service_account.platform[each.value].email}"
}

resource "google_project_iam_member" "deploy_roles" {
  for_each = toset([
    "roles/artifactregistry.writer",
    "roles/run.admin",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.platform["deploy"].email}"
}

resource "google_project_iam_member" "website_recaptcha_agent" {
  project = var.project_id
  role    = "roles/recaptchaenterprise.agent"
  member  = "serviceAccount:${google_service_account.platform["website"].email}"
}

resource "google_service_account_iam_member" "deploy_act_as" {
  for_each = local.act_as_service_accounts

  service_account_id = google_service_account.platform[each.value].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.platform["deploy"].email}"
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "${var.name_prefix}-github"
  display_name              = "Smart-Job GitHub Actions"
  description               = "Short-lived GitHub Actions deployment identity"
  disabled                  = false

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "Smart-Job deploy workflow"

  attribute_mapping = {
    "google.subject"             = "assertion.sub"
    "attribute.actor"            = "assertion.actor"
    "attribute.workflow_ref"     = "assertion.workflow_ref"
    "attribute.repository"       = "assertion.repository"
    "attribute.repository_owner" = "assertion.repository_owner"
  }

  attribute_condition = join(" && ", [
    "assertion.repository_owner_id == '${var.github_repository_owner_id}'",
    "assertion.repository == '${var.github_repository}'",
    "assertion.workflow_ref == '${var.github_deploy_workflow_ref}'",
  ])

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "github_deploy" {
  service_account_id = google_service_account.platform["deploy"].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}
