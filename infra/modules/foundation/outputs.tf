output "artifact_registry_repository" {
  description = "Artifact Registry repository resource."
  value       = google_artifact_registry_repository.release
}

output "artifact_registry_prefix" {
  description = "Allowed immutable image-repository prefix for this environment."
  value       = "${google_artifact_registry_repository.release.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.release.repository_id}/"
}

output "network_id" {
  description = "Platform VPC network ID."
  value       = google_compute_network.platform.id
}

output "primary_subnet_id" {
  description = "Primary regional subnet ID."
  value       = google_compute_subnetwork.primary.id
}

output "tax_subnet_id" {
  description = "Tax regional subnet ID."
  value       = google_compute_subnetwork.tax.id
}

output "primary_egress_ip" {
  description = "Stable primary region egress address."
  value       = google_compute_address.primary_egress.address
}

output "tax_egress_ip" {
  description = "Stable tax region egress address for authority allowlisting."
  value       = google_compute_address.tax_egress.address
}

output "service_accounts" {
  description = "Runtime and deployment service-account emails."
  value       = { for key, account in google_service_account.platform : key => account.email }
}

output "secret_ids" {
  description = "Secret Manager container IDs; never secret values."
  value       = { for key, secret in google_secret_manager_secret.runtime : key => secret.secret_id }
}

output "archive_bucket_name" {
  value = google_storage_bucket.archive.name
}

output "backup_bucket_name" {
  value = google_storage_bucket.backup.name
}

output "workload_identity_provider" {
  description = "Provider resource name consumed by google-github-actions/auth."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deploy_service_account" {
  value = google_service_account.platform["deploy"].email
}
