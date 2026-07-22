terraform {
  required_version = ">= 1.14.3, < 1.15.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "= 7.40.0"
    }
  }

  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.primary_region
}
