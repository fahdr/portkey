# OpnSense Local DNS Setup for Talos Cluster

## Overview

Since you're using Cloudflared for external access, you need local DNS overrides in OpnSense so that internal devices can access your applications via the ingress controller instead of going through the tunnel.

## Configuration

### Ingress Controller IP
- **NGINX Ingress LoadBalancer IP**: `192.168.0.224`

### OpnSense Configuration Steps

#### Option 1: Via OpnSense Web UI

1. Navigate to **Services → Unbound DNS → Overrides**

2. Add Host Override for each application:
   - **Host**: application name (e.g., `argocd`)
   - **Domain**: `themainfreak.com`
   - **Type**: `A` record
   - **IP**: `192.168.0.224`
   - **Description**: Application name

#### Option 2: Via OpnSense CLI (SSH)

```bash
# SSH into OpnSense
ssh root@192.168.0.1  # or your OpnSense IP

# Add DNS overrides (one-liner for each app)
# This assumes you're using Unbound DNS
```

### Applications to Add

Based on typical homelab setup, here are the common applications:

```
argocd.themainfreak.com         → 192.168.0.224
vaultwarden.themainfreak.com    → 192.168.0.224
nextcloud.themainfreak.com      → 192.168.0.224
immich.themainfreak.com         → 192.168.0.224
jellyfin.themainfreak.com       → 192.168.0.224
hass.themainfreak.com          → 192.168.0.224
paperless.themainfreak.com      → 192.168.0.224
grocy.themainfreak.com          → 192.168.0.224
babybuddy.themainfreak.com      → 192.168.0.224
actualbudget.themainfreak.com   → 192.168.0.224
homepage.themainfreak.com       → 192.168.0.224
excalidraw.themainfreak.com     → 192.168.0.224
pairdrop.themainfreak.com       → 192.168.0.224
speedtest.themainfreak.com      → 192.168.0.224
esphome.themainfreak.com        → 192.168.0.224
navidrome.themainfreak.com      → 192.168.0.224
radarr.themainfreak.com         → 192.168.0.224
sonarr.themainfreak.com         → 192.168.0.224
prowlarr.themainfreak.com       → 192.168.0.224
lidarr.themainfreak.com         → 192.168.0.224
jellyseerr.themainfreak.com     → 192.168.0.224
transmission.themainfreak.com   → 192.168.0.224
```

### Wildcard DNS (Recommended)

Instead of adding each application individually, you can create a wildcard DNS override:

**Unbound Configuration:**

1. Go to **Services → Unbound DNS → General**
2. Click on **Advanced Options**
3. Add custom option:

```
server:
    local-zone: "themainfreak.com." redirect
    local-data: "themainfreak.com. A 192.168.0.224"
```

Or add individual wildcard override:
- **Host**: `*`
- **Domain**: `themainfreak.com`
- **Type**: `A`
- **IP**: `192.168.0.224`

**Note**: Wildcard DNS means ALL subdomains of `themainfreak.com` will resolve to `192.168.0.224`. The NGINX ingress controller will route based on the hostname.

### Verification

After adding DNS overrides, test from any device on your network:

```bash
# Test DNS resolution
nslookup argocd.themainfreak.com
# Should return 192.168.0.224

# Test HTTPS access
curl -k https://argocd.themainfreak.com
# Should return ArgoCD login page

# Or open in browser
# https://argocd.themainfreak.com
```

### AdGuard Home Alternative

If using AdGuard Home instead of Unbound:

1. Navigate to **Filters → DNS rewrites**
2. Add rewrite rule:
   - **Domain**: `*.themainfreak.com`
   - **Answer**: `192.168.0.224`

### Traffic Flow

**With Local DNS:**
```
Device → OpnSense DNS (192.168.0.1)
  → Resolves *.themainfreak.com to 192.168.0.224
  → NGINX Ingress Controller (192.168.0.224)
  → Routes to correct pod based on hostname
```

**External Traffic (via Cloudflared):**
```
External User → Cloudflare CDN
  → Cloudflare Tunnel (cloudflared)
  → NGINX Ingress Controller (192.168.0.224)
  → Application pod
```

## Troubleshooting

### DNS not resolving

```bash
# Check OpnSense Unbound status
# Services → Unbound DNS → Overview

# Restart Unbound DNS
# Services → Unbound DNS → Overview → Restart

# Check DNS query log
# Services → Unbound DNS → Query Log
```

### Still going through Cloudflare tunnel

- Check DNS cache on client device
- Clear DNS cache:
  ```bash
  # Windows
  ipconfig /flushdns

  # macOS/Linux
  sudo dscacheutil -flushcache  # macOS
  sudo systemd-resolve --flush-caches  # Linux
  ```

### Certificate warnings

- If using self-signed certs or Let's Encrypt, you may get certificate warnings on local network
- This is normal - the cert is issued for the public domain
- Consider using cert-manager with a local CA for internal access

## Best Practices

1. **Use wildcard DNS** - Easier to manage, automatically covers new apps
2. **Keep track of ingresses** - Document which apps are exposed
3. **Monitor DNS logs** - Verify local resolution is working
4. **Test both internal and external** - Ensure both paths work

## Future Enhancements

### Split-brain DNS

For more sophisticated setup:
- External DNS (Cloudflare) → Public IPs → Cloudflare Tunnel
- Internal DNS (OpnSense) → Private IPs → Direct ingress

### Internal-only apps

For apps that should NEVER be exposed externally:
- Don't create Cloudflare tunnel for them
- Only add to local DNS
- Examples: ESPHome, internal admin tools

---

**Created**: 2026-02-08
**Ingress IP**: 192.168.0.224
**Domain**: themainfreak.com
