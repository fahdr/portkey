terraform {
  required_version = ">= 1.6.0"

  backend "remote" {
    hostname     = "app.terraform.io"
    organization = "themainfreak"

    workspaces {
      name = "portkey-external"
    }
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.30.0"
    }

    kubernetes = {
      source = "hashicorp/kubernetes"
      version = "2.27.0"
    }

    http = {
      source  = "hashicorp/http"
      version = "~> 3.4.0"
    }
  }
}

provider "cloudflare" {
  email   = var.cloudflare_email
  api_key = var.cloudflare_api_key
}

provider "kubernetes" {
  # Use KUBE_CONFIG_PATH environment variables
  # Or in cluster service account
  config_path = "/workspaces/portkey/metal/kubeconfig.yaml"
}
