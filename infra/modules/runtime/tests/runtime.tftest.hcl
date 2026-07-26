mock_provider "google" {}

variables {
  project_id            = "smart-job-test"
  environment           = "dev"
  name_prefix           = "smart-job-test"
  enable_runtime        = false
  primary_region        = "europe-west3"
  tax_region            = "me-west1"
  network_id            = "projects/smart-job-test/global/networks/platform"
  primary_subnet_id     = "projects/smart-job-test/regions/europe-west3/subnetworks/primary"
  tax_subnet_id         = "projects/smart-job-test/regions/me-west1/subnetworks/tax"
  archive_bucket_name   = "smart-job-test-archive"
  backup_bucket_name    = "smart-job-test-backup"
  website_origin        = "https://app.test.example.com"
  api_origin            = "https://api.test.example.com"
  tax_origin            = "https://tax.test.example.com"
  recaptcha_site_key    = "test-public-site-key"
  image_registry_prefix = "europe-west3-docker.pkg.dev/smart-job-test/smart-job/"

  service_accounts = {
    website     = "website@smart-job-test.iam.gserviceaccount.com"
    api         = "api@smart-job-test.iam.gserviceaccount.com"
    tax         = "tax@smart-job-test.iam.gserviceaccount.com"
    pdf         = "pdf@smart-job-test.iam.gserviceaccount.com"
    email       = "email@smart-job-test.iam.gserviceaccount.com"
    archiver    = "archiver@smart-job-test.iam.gserviceaccount.com"
    backup      = "backup@smart-job-test.iam.gserviceaccount.com"
    migrator    = "migrator@smart-job-test.iam.gserviceaccount.com"
    scheduler   = "scheduler@smart-job-test.iam.gserviceaccount.com"
    smoke       = "smoke@smart-job-test.iam.gserviceaccount.com"
    pubsub-push = "pubsub-push@smart-job-test.iam.gserviceaccount.com"
  }

  secret_ids = {
    api_database_url              = "test-api-database-url"
    archiver_database_url         = "test-archiver-database-url"
    backup_database_url           = "test-backup-database-url"
    aws_access_key_id             = "test-aws-access-key-id"
    aws_secret_access_key         = "test-aws-secret-access-key"
    contact_challenge_secret      = "test-contact-challenge-secret"
    email_database_url            = "test-email-database-url"
    migrator_database_url         = "test-migrator-database-url"
    pdf_database_url              = "test-pdf-database-url"
    ses_from_email                = "test-ses-from-email"
    supabase_publishable_key      = "test-supabase-publishable-key"
    supabase_s3_access_key_id     = "test-supabase-s3-access-key-id"
    supabase_s3_secret_access_key = "test-supabase-s3-secret-access-key"
    supabase_secret_key           = "test-supabase-secret-key"
    supabase_url                  = "test-supabase-url"
    web_session_encryption_key    = "test-web-session-key"
    website_session_secret        = "test-website-session-secret"
  }

  secret_versions = {
    test-api-database-url              = "1"
    test-archiver-database-url         = "1"
    test-backup-database-url           = "1"
    test-aws-access-key-id             = "1"
    test-aws-secret-access-key         = "1"
    test-contact-challenge-secret      = "1"
    test-email-database-url            = "1"
    test-migrator-database-url         = "1"
    test-pdf-database-url              = "1"
    test-ses-from-email                = "1"
    test-supabase-publishable-key      = "1"
    test-supabase-s3-access-key-id     = "1"
    test-supabase-s3-secret-access-key = "1"
    test-supabase-secret-key           = "1"
    test-supabase-url                  = "1"
    test-web-session-key               = "1"
    test-website-session-secret        = "1"
  }

  image_digests = {
    website   = "europe-west3-docker.pkg.dev/smart-job-test/smart-job/website@sha256:0000000000000000000000000000000000000000000000000000000000000000"
    api       = "europe-west3-docker.pkg.dev/smart-job-test/smart-job/cloudrun-api@sha256:0000000000000000000000000000000000000000000000000000000000000000"
    tax       = "europe-west3-docker.pkg.dev/smart-job-test/smart-job/cloudrun-tax@sha256:0000000000000000000000000000000000000000000000000000000000000000"
    pdf       = "europe-west3-docker.pkg.dev/smart-job-test/smart-job/cloudrun-pdf@sha256:0000000000000000000000000000000000000000000000000000000000000000"
    email     = "europe-west3-docker.pkg.dev/smart-job-test/smart-job/cloudrun-email@sha256:0000000000000000000000000000000000000000000000000000000000000000"
    archiver  = "europe-west3-docker.pkg.dev/smart-job-test/smart-job/cloudrun-archiver@sha256:0000000000000000000000000000000000000000000000000000000000000000"
    backup    = "europe-west3-docker.pkg.dev/smart-job-test/smart-job/cloudrun-backup@sha256:0000000000000000000000000000000000000000000000000000000000000000"
    migration = "europe-west3-docker.pkg.dev/smart-job-test/smart-job/cloudrun-migrations@sha256:0000000000000000000000000000000000000000000000000000000000000000"
  }

  supabase_connection_limit = 100
  service_max_instances = {
    website = 4
    api     = 8
    tax     = 3
    pdf     = 3
    email   = 3
  }
  database_pool_max = {
    api       = 5
    pdf       = 3
    email     = 3
    archiver  = 1
    migration = 2
  }
}

run "foundation_phase_has_no_workloads" {
  command = plan

  assert {
    condition     = length(google_cloud_run_v2_service.service) == 0
    error_message = "Runtime-disabled plans must not create Cloud Run services."
  }

  assert {
    condition     = output.database_connection_budget == 62
    error_message = "The default maximum database allocation must remain explicit."
  }
}

run "enabled_runtime_preserves_scaling_and_job_bounds" {
  command = plan

  variables {
    enable_runtime = true
  }

  assert {
    condition     = google_cloud_run_v2_service.service["website"].scaling[0].min_instance_count == 1
    error_message = "Website must retain one warm instance."
  }

  assert {
    condition     = google_cloud_run_v2_service.service["pdf"].scaling[0].min_instance_count == 0
    error_message = "PDF must retain scale-to-zero behavior."
  }

  assert {
    condition     = google_cloud_run_v2_job.job["archiver"].template[0].task_count == 1
    error_message = "Archiver must remain a single-task job."
  }

  assert {
    condition     = google_cloud_run_v2_job.job["backup-storage"].template[0].task_count == 1 && google_cloud_scheduler_job.backup["storage"].schedule == "*/15 * * * *"
    error_message = "Storage backup must remain single-task and run every fifteen minutes."
  }

  assert {
    condition     = google_cloud_scheduler_job.api_drain["tax"].paused
    error_message = "Tax submission drain must remain paused."
  }

  assert {
    condition     = length(google_pubsub_subscription.dead_letter) == 3
    error_message = "Every durable worker queue must expose a retained dead-letter inspection subscription."
  }

  assert {
    condition     = output.subscription_names["email_delivery_dead_letter"] == "smart-job-test-email-delivery-dlq-inspect"
    error_message = "Dead-letter inspection subscriptions must be included in monitoring outputs."
  }
}

run "release_job_bootstrap_precedes_services" {
  command = plan

  variables {
    enable_release_jobs = true
  }

  assert {
    condition     = length(google_cloud_run_v2_service.service) == 0
    error_message = "Release-job bootstrap must not create serving workloads."
  }

  assert {
    condition     = toset(keys(google_cloud_run_v2_job.job)) == toset(["migration", "smoke"])
    error_message = "Release-job bootstrap must create only migration and smoke jobs."
  }
}

run "staging_telemetry_uses_a_pinned_collector_sidecar" {
  command = plan

  variables {
    enable_runtime = true
    enable_otel    = true
  }

  assert {
    condition = one([
      for container in google_cloud_run_v2_service.service["api"].template[0].containers :
      container.image if container.name == "collector"
    ]) == "us-docker.pkg.dev/cloud-ops-agents-artifacts/google-cloud-opentelemetry-collector/otelcol-google:0.156.0@sha256:8a141713e33e4584b3bd24e0db39d56a8e650edb03d79b6bf3de82ff1cdd97f9"
    error_message = "OTel must use the reviewed Google-built collector digest."
  }

  assert {
    condition = contains(
      google_cloud_run_v2_service.service["api"].template[0].containers[0].depends_on,
      "collector",
    )
    error_message = "The application must wait for the collector sidecar startup probe."
  }

  assert {
    condition = length([
      for container in google_cloud_run_v2_service.service["website"].template[0].containers :
      container if container.name == "collector"
    ]) == 0
    error_message = "The cache-compatible website must not receive the Node service collector."
  }
}

run "federated_email_uses_only_short_lived_aws_credentials" {
  command = plan

  variables {
    enable_runtime = true
    email_ses_federation = {
      enabled                          = true
      role_arn                         = "arn:aws:iam::123456789012:role/smart-job-email-ses"
      oidc_audience                    = "smart-job-email-staging"
      google_service_account_unique_id = "123456789012345678901"
    }
  }

  assert {
    condition = contains([
      for env in google_cloud_run_v2_service.service["email"].template[0].containers[0].env :
      env.name
    ], "AWS_SES_ROLE_ARN")
    error_message = "Federated email must receive the reviewed AWS role ARN."
  }

  assert {
    condition = !contains([
      for env in google_cloud_run_v2_service.service["email"].template[0].containers[0].env :
      env.name
      ], "AWS_ACCESS_KEY_ID") && !contains([
      for env in google_cloud_run_v2_service.service["email"].template[0].containers[0].env :
      env.name
    ], "AWS_SECRET_ACCESS_KEY")
    error_message = "Federated email must not mount static AWS credentials."
  }
}

run "connection_budget_overflow_is_rejected" {
  command = plan

  variables {
    service_max_instances = {
      website = 4
      api     = 20
      tax     = 3
      pdf     = 10
      email   = 10
    }
  }

  expect_failures = [terraform_data.deployment_preconditions]
}
