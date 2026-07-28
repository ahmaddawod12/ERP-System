output "role_arn" {
  value       = aws_iam_role.email.arn
  description = "Set as AWS_SES_ROLE_ARN after staging federation validation."
}

output "oidc_audience" {
  value       = var.oidc_audience
  description = "Set as AWS_SES_OIDC_AUDIENCE."
}

output "google_service_account_unique_id" {
  value       = var.google_service_account_unique_id
  description = "Set as AWS_GOOGLE_SERVICE_ACCOUNT_UNIQUE_ID."
}
