locals {
  labels = merge(var.labels, {
    application = "smart-job"
    environment = var.environment
    managed-by  = "terraform"
  })

  public_backends = {
    website = {
      hostname   = var.hostnames.website
      location   = var.primary_region
      service    = lookup(var.service_names, "website", "")
      rate_limit = var.rate_limits_per_minute.website
    }
    api = {
      hostname   = var.hostnames.api
      location   = var.primary_region
      service    = lookup(var.service_names, "api", "")
      rate_limit = var.rate_limits_per_minute.api
    }
    tax = {
      hostname   = var.hostnames.tax
      location   = var.tax_region
      service    = lookup(var.service_names, "tax", "")
      rate_limit = var.rate_limits_per_minute.tax
    }
  }
}

resource "terraform_data" "edge_preconditions" {
  input = var.enable_runtime

  lifecycle {
    precondition {
      condition = !var.enable_runtime || alltrue([
        for hostname in values(var.hostnames) :
        can(regex("^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$", hostname))
      ])
      error_message = "Every public hostname must be a valid lower-case DNS hostname."
    }

    precondition {
      condition = !var.enable_runtime || alltrue([
        for hostname in values(var.hostnames) :
        hostname == var.root_domain || endswith(hostname, ".${var.root_domain}")
      ])
      error_message = "Every public hostname must belong to root_domain."
    }

    precondition {
      condition     = !var.enable_runtime || length(toset(values(var.hostnames))) == 3
      error_message = "Website, API, and tax must use distinct public hostnames."
    }

    precondition {
      condition = !var.enable_runtime || alltrue([
        for service in ["website", "api", "tax"] :
        trimspace(lookup(var.service_names, service, "")) != ""
      ])
      error_message = "The edge module requires website, api, and tax Cloud Run service names."
    }
  }
}

resource "google_dns_managed_zone" "public" {
  count = var.enable_runtime ? 1 : 0

  project     = var.project_id
  name        = "${var.name_prefix}-public"
  dns_name    = "${trimsuffix(var.root_domain, ".")}."
  description = "Smart-Job ${var.environment} public DNS"
  visibility  = "public"
  labels      = local.labels

  dnssec_config {
    state = "on"
  }

  depends_on = [terraform_data.edge_preconditions]
}

resource "google_compute_global_address" "public" {
  count = var.enable_runtime ? 1 : 0

  project      = var.project_id
  name         = "${var.name_prefix}-public"
  address_type = "EXTERNAL"
  ip_version   = "IPV4"
}

resource "google_compute_region_network_endpoint_group" "cloud_run" {
  for_each = var.enable_runtime ? local.public_backends : {}

  project               = var.project_id
  name                  = "${var.name_prefix}-${each.key}-neg"
  region                = each.value.location
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = each.value.service
  }

  depends_on = [terraform_data.edge_preconditions]
}

resource "google_compute_security_policy" "backend" {
  for_each = var.enable_runtime ? local.public_backends : {}

  project     = var.project_id
  name        = "${var.name_prefix}-${each.key}-armor"
  description = "Cloud Armor controls for the ${each.key} backend"
  type        = "CLOUD_ARMOR"

  rule {
    action      = "deny(403)"
    priority    = 1000
    description = "OWASP SQL injection signatures"
    preview     = var.armor_waf_preview

    match {
      expr {
        expression = "evaluatePreconfiguredWaf('sqli-v33-stable')"
      }
    }
  }

  rule {
    action      = "deny(403)"
    priority    = 1010
    description = "OWASP cross-site scripting signatures"
    preview     = var.armor_waf_preview

    match {
      expr {
        expression = "evaluatePreconfiguredWaf('xss-v33-stable')"
      }
    }
  }

  rule {
    action      = "throttle"
    priority    = 2000
    description = "Per-client request throttle"

    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }

    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"

      rate_limit_threshold {
        count        = each.value.rate_limit
        interval_sec = 60
      }
    }
  }

  rule {
    action      = "allow"
    priority    = 2147483647
    description = "Default allow after managed controls"

    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }
}

resource "google_compute_backend_service" "cloud_run" {
  for_each = var.enable_runtime ? local.public_backends : {}

  project               = var.project_id
  name                  = "${var.name_prefix}-${each.key}-backend"
  protocol              = "HTTP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  timeout_sec           = 30
  security_policy       = google_compute_security_policy.backend[each.key].id

  backend {
    group = google_compute_region_network_endpoint_group.cloud_run[each.key].id
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

resource "google_compute_url_map" "https" {
  count = var.enable_runtime ? 1 : 0

  project         = var.project_id
  name            = "${var.name_prefix}-https"
  description     = "Host routing for Smart-Job public services"
  default_service = google_compute_backend_service.cloud_run["website"].id

  dynamic "host_rule" {
    for_each = local.public_backends
    content {
      hosts        = [host_rule.value.hostname]
      path_matcher = host_rule.key
    }
  }

  dynamic "path_matcher" {
    for_each = local.public_backends
    content {
      name            = path_matcher.key
      default_service = google_compute_backend_service.cloud_run[path_matcher.key].id
    }
  }
}

resource "google_compute_managed_ssl_certificate" "public" {
  count = var.enable_runtime ? 1 : 0

  project     = var.project_id
  name        = "${var.name_prefix}-public"
  description = "Google-managed certificate for Smart-Job public origins"

  managed {
    domains = sort(values(var.hostnames))
  }
}

resource "google_compute_ssl_policy" "modern" {
  count = var.enable_runtime ? 1 : 0

  project         = var.project_id
  name            = "${var.name_prefix}-modern-tls"
  profile         = "MODERN"
  min_tls_version = "TLS_1_2"
}

resource "google_compute_target_https_proxy" "public" {
  count = var.enable_runtime ? 1 : 0

  project          = var.project_id
  name             = "${var.name_prefix}-https"
  url_map          = google_compute_url_map.https[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.public[0].id]
  ssl_policy       = google_compute_ssl_policy.modern[0].id
  quic_override    = "ENABLE"
}

resource "google_compute_global_forwarding_rule" "https" {
  count = var.enable_runtime ? 1 : 0

  project               = var.project_id
  name                  = "${var.name_prefix}-https"
  target                = google_compute_target_https_proxy.public[0].id
  ip_address            = google_compute_global_address.public[0].id
  port_range            = "443"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  network_tier          = "PREMIUM"
}

resource "google_compute_url_map" "http_redirect" {
  count = var.enable_runtime ? 1 : 0

  project     = var.project_id
  name        = "${var.name_prefix}-http-redirect"
  description = "Redirect plaintext requests to HTTPS"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  count = var.enable_runtime ? 1 : 0

  project = var.project_id
  name    = "${var.name_prefix}-http-redirect"
  url_map = google_compute_url_map.http_redirect[0].id
}

resource "google_compute_global_forwarding_rule" "http" {
  count = var.enable_runtime ? 1 : 0

  project               = var.project_id
  name                  = "${var.name_prefix}-http"
  target                = google_compute_target_http_proxy.redirect[0].id
  ip_address            = google_compute_global_address.public[0].id
  port_range            = "80"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  network_tier          = "PREMIUM"
}

resource "google_dns_record_set" "public_a" {
  for_each = var.enable_runtime ? local.public_backends : {}

  project      = var.project_id
  managed_zone = google_dns_managed_zone.public[0].name
  name         = "${trimsuffix(each.value.hostname, ".")}."
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.public[0].address]
}

resource "google_dns_record_set" "certificate_authority" {
  count = var.enable_runtime ? 1 : 0

  project      = var.project_id
  managed_zone = google_dns_managed_zone.public[0].name
  name         = "${trimsuffix(var.root_domain, ".")}."
  type         = "CAA"
  ttl          = 300
  rrdatas      = ["0 issue \"pki.goog\""]
}
