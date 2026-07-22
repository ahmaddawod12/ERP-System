output "slo_ids" {
  value = { for key, slo in google_monitoring_slo.availability : key => slo.name }
}

output "dashboard_id" {
  value = try(google_monitoring_dashboard.platform[0].id, null)
}
