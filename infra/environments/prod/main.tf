locals {
  environment = "prod"
  name_prefix = "smart-job-prod"
}

module "foundation" {
  source = "../../modules/foundation"

  project_id                       = var.project_id
  environment                      = local.environment
  name_prefix                      = local.name_prefix
  primary_region                   = var.primary_region
  tax_region                       = var.tax_region
  primary_subnet_cidr              = var.primary_subnet_cidr
  tax_subnet_cidr                  = var.tax_subnet_cidr
  archive_bucket_name              = var.archive_bucket_name
  backup_bucket_name               = var.backup_bucket_name
  archive_retention_days           = var.archive_retention_days
  backup_retention_days            = var.backup_retention_days
  lock_backup_retention            = var.lock_backup_retention
  backup_restore_drill_verified    = var.backup_restore_drill_verified
  enable_static_ses_credentials    = !var.email_ses_federation.enabled
  github_repository                = "ahmaddawod12/ERP-System"
  github_repository_owner_id       = var.github_repository_owner_id
  github_deploy_workflow_ref       = var.github_deploy_workflow_ref
  artifact_registry_reader_members = var.artifact_registry_reader_members
  labels                           = var.labels
}
