# Vaultwarden CLI secrets (needed to bootstrap Vaultwarden itself)
resource "kubernetes_secret" "vaultwarden_cli" {
  metadata {
    name      = "vaultwarden-cli"
    namespace = "global-secrets"
    annotations = {
      "app.kubernetes.io/managed-by" = "Terraform"
    }
  }

  data = {
    BW_CLIENTID     = var.vaultwarden_client_id
    BW_CLIENTSECRET = var.vaultwarden_client_secret
    BW_PASSWORD     = var.vaultwarden_master_password
  }
}
