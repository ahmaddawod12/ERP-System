module "runtime" {
  source = "../../modules/runtime"

  project_id                = var.project_id
  environment               = local.environment
  name_prefix               = local.name_prefix
  enable_runtime            = var.enable_runtime
  enable_release_jobs       = var.enable_release_jobs
  primary_region            = var.primary_region
  tax_region                = var.tax_region
  network_id                = module.foundation.network_id
  primary_subnet_id         = module.foundation.primary_subnet_id
  tax_subnet_id             = module.foundation.tax_subnet_id
  service_accounts          = module.foundation.service_accounts
  secret_ids                = module.foundation.secret_ids
  secret_versions           = var.secret_versions
  archive_bucket_name       = module.foundation.archive_bucket_name
  image_digests             = var.image_digests
  image_registry_prefix     = module.foundation.artifact_registry_prefix
  website_origin            = "https://${var.website_hostname}"
  api_origin                = "https://${var.api_hostname}"
  tax_origin                = "https://${var.tax_hostname}"
  recaptcha_site_key        = var.recaptcha_site_key
  web_session_key_version   = var.web_session_key_version
  supabase_connection_limit = var.supabase_connection_limit
  service_max_instances     = var.service_max_instances
  database_pool_max         = var.database_pool_max
  labels                    = var.labels
}

module "edge" {
  source = "../../modules/edge"

  project_id        = var.project_id
  environment       = local.environment
  name_prefix       = local.name_prefix
  enable_runtime    = var.enable_runtime
  primary_region    = var.primary_region
  tax_region        = var.tax_region
  service_names     = module.runtime.service_names
  root_domain       = var.root_domain
  armor_waf_preview = var.armor_waf_preview
  labels            = var.labels
  hostnames = {
    website = var.website_hostname
    api     = var.api_hostname
    tax     = var.tax_hostname
  }
}

module "observability" {
  source = "../../modules/observability"

  project_id     = var.project_id
  environment    = local.environment
  name_prefix    = local.name_prefix
  enable_runtime = var.enable_runtime
  service_names  = module.runtime.service_names
  service_locations = {
    website = var.primary_region
    api     = var.primary_region
    tax     = var.tax_region
    pdf     = var.primary_region
    email   = var.primary_region
  }
  subscription_names    = module.runtime.subscription_names
  notification_channels = var.notification_channels
  labels                = var.labels
}
