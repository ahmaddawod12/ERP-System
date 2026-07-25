mock_provider "google" {}

variables {
  project_id     = "smart-job-test"
  environment    = "dev"
  name_prefix    = "smart-job-test"
  enable_runtime = false
  primary_region = "europe-west3"
  tax_region     = "me-west1"
  root_domain    = "test.example.com"

  service_names = {
    website = "smart-job-test-website"
    api     = "smart-job-test-api"
    tax     = "smart-job-test-tax"
  }

  hostnames = {
    website = "app.test.example.com"
    api     = "api.test.example.com"
    tax     = "tax.test.example.com"
  }
}

run "disabled_edge_creates_no_public_resources" {
  command = plan

  assert {
    condition     = length(google_compute_security_policy.backend) == 0
    error_message = "Runtime-disabled plans must not expose public backends."
  }
}

run "sensitive_routes_have_dedicated_throttles" {
  command = plan

  variables {
    enable_runtime = true
  }

  assert {
    condition = one([
      for rule in google_compute_security_policy.backend["website"].rule : rule.rate_limit_options[0].rate_limit_threshold[0].count
      if rule.priority == 1100
    ]) == 30
    error_message = "Website authentication routes must use the dedicated 30-per-minute throttle."
  }

  assert {
    condition = one([
      for rule in google_compute_security_policy.backend["api"].rule : rule.rate_limit_options[0].rate_limit_threshold[0].interval_sec
      if rule.priority == 1110
    ]) == 300
    error_message = "API contact requests must use the dedicated five-minute throttle window."
  }

  assert {
    condition = length([
      for rule in google_compute_security_policy.backend["tax"].rule : rule
      if contains([1100, 1110], rule.priority)
    ]) == 0
    error_message = "Website/API route expressions must not be copied onto the tax backend."
  }

}

run "invalid_sensitive_route_window_is_rejected" {
  command = plan

  variables {
    sensitive_route_rate_limits = {
      auth = {
        count            = 30
        interval_seconds = 0
      }
      contact = {
        count            = 20
        interval_seconds = 300
      }
    }
  }

  expect_failures = [var.sensitive_route_rate_limits]
}
