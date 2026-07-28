output "service_uris" {
  description = "Cloud Run service URIs. Public clients use load-balancer origins instead."
  value       = { for key, service in google_cloud_run_v2_service.service : key => service.uri }
}

output "service_names" {
  value = { for key, service in google_cloud_run_v2_service.service : key => service.name }
}

output "job_names" {
  value = { for key, job in google_cloud_run_v2_job.job : key => job.name }
}

output "topic_names" {
  value = { for key, topic in google_pubsub_topic.task : key => topic.name }
}

output "subscription_names" {
  value = merge(
    { for key, subscription in google_pubsub_subscription.push : key => subscription.name },
    {
      for key, subscription in google_pubsub_subscription.dead_letter :
      "${key}_dead_letter" => subscription.name
    },
  )
}

output "database_connection_budget" {
  description = "Worst-case runtime pool allocation checked against the 70% ceiling."
  value       = local.database_connection_budget
}

output "database_connection_ceiling" {
  value = floor(var.database_connection_limit * 0.70)
}
