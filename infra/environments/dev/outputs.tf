output "foundation" {
  description = "Non-sensitive bootstrap outputs used by operators and CI."
  value = {
    archive_bucket             = module.foundation.archive_bucket_name
    backup_bucket              = module.foundation.backup_bucket_name
    deploy_service_account     = module.foundation.deploy_service_account
    primary_egress_ip          = module.foundation.primary_egress_ip
    tax_egress_ip              = module.foundation.tax_egress_ip
    workload_identity_provider = module.foundation.workload_identity_provider
  }
}

output "secret_container_ids" {
  description = "Containers to populate out of band; values are never managed here."
  value       = module.foundation.secret_ids
}

output "runtime" {
  value = {
    database_connection_budget  = module.runtime.database_connection_budget
    database_connection_ceiling = module.runtime.database_connection_ceiling
    jobs                        = module.runtime.job_names
    services                    = module.runtime.service_uris
    topics                      = module.runtime.topic_names
  }
}

output "edge" {
  value = {
    dns_name_servers = module.edge.dns_name_servers
    public_ip        = module.edge.public_ip
  }
}
