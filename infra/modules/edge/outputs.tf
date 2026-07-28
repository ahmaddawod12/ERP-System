output "public_ip" {
  value = try(google_compute_global_address.public[0].address, null)
}

output "dns_name_servers" {
  description = "Delegate the root domain to these servers after the first apply."
  value       = try(google_dns_managed_zone.public[0].name_servers, [])
}

output "managed_certificate_id" {
  value = try(google_compute_managed_ssl_certificate.public[0].id, null)
}

output "cloud_armor_policy_ids" {
  value = { for key, policy in google_compute_security_policy.backend : key => policy.id }
}
