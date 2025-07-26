variable "cloudflare_email" {
  type = string
}

variable "cloudflare_api_key" {
  type      = string
  sensitive = true
}

variable "cloudflare_account_id" {
  type = string
}

variable "zerotier_central_token" {
  type = string
}

variable "vaultwarden_client_id" {
  type        = string
  description = "Vaultwarden OAuth2 client ID for external secrets integration"
  sensitive   = true
}

variable "vaultwarden_client_secret" {
  type        = string
  description = "Vaultwarden OAuth2 client secret for external secrets integration"
  sensitive   = true
}

variable "vaultwarden_master_password" {
  type        = string
  description = "Vaultwarden master password for vault unlocking"
  sensitive   = true
}

variable "ntfy" {
  type = object({
    url   = string
    topic = string
  })

  sensitive = true
}

variable "extra_secrets" {
  type        = map(string)
  description = "Key-value pairs of extra secrets that cannot be randomly generated (e.g. third party API tokens)"
  sensitive   = true
  default     = {}
}
