#!/bin/bash
# Generate OpnSense DNS override entries for all applications

INGRESS_IP="192.168.0.224"
DOMAIN="themainfreak.com"

echo "================================================"
echo "OpnSense DNS Override Configuration"
echo "================================================"
echo ""
echo "Ingress IP: $INGRESS_IP"
echo "Domain: $DOMAIN"
echo ""
echo "OPTION 1: Wildcard DNS (Recommended)"
echo "================================================"
echo "Add this to OpnSense Unbound DNS -> Overrides:"
echo "  Host: *"
echo "  Domain: $DOMAIN"
echo "  Type: A"
echo "  IP: $INGRESS_IP"
echo ""
echo "Or add to Custom Options:"
echo "  server:"
echo "      local-zone: \"$DOMAIN.\" redirect"
echo "      local-data: \"$DOMAIN. A $INGRESS_IP\""
echo ""
echo "================================================"
echo "OPTION 2: Individual Host Overrides"
echo "================================================"
echo "If you prefer individual entries, add these:"
echo ""

# List of applications from the apps directory
apps=(
    "actualbudget"
    "argocd"
    "babybuddy"
    "esphome"
    "excalidraw"
    "grocy"
    "homeassistant"
    "homepage"
    "immich"
    "jellyfin"
    "mosquitto"
    "navidrome"
    "nextcloud"
    "ollama"
    "pairdrop"
    "paperless"
    "speedtest"
    "vaultwarden"
    "zigbee2mqtt"
)

# Common aliases
declare -A aliases
aliases=(
    ["homeassistant"]="hass"
)

for app in "${apps[@]}"; do
    hostname="$app"
    # Use alias if exists
    if [ -n "${aliases[$app]}" ]; then
        hostname="${aliases[$app]}"
    fi

    echo "Host: $hostname | Domain: $DOMAIN | Type: A | IP: $INGRESS_IP"
done

echo ""
echo "================================================"
echo "OPTION 3: AdGuard Home DNS Rewrites"
echo "================================================"
echo "If using AdGuard Home instead of Unbound:"
echo ""
echo "Navigate to: Filters -> DNS rewrites"
echo "Add: *.$DOMAIN -> $INGRESS_IP"
echo ""
echo "Or individual entries:"
for app in "${apps[@]}"; do
    hostname="$app"
    if [ -n "${aliases[$app]}" ]; then
        hostname="${aliases[$app]}"
    fi
    echo "$hostname.$DOMAIN -> $INGRESS_IP"
done

echo ""
echo "================================================"
echo "Verification"
echo "================================================"
echo "After configuration, test from any device:"
echo ""
echo "  nslookup argocd.$DOMAIN"
echo "  # Should return $INGRESS_IP"
echo ""
echo "  curl -k https://argocd.$DOMAIN"
echo "  # Should return ArgoCD login page"
echo ""
echo "================================================"
echo "CSV Export (for bulk import)"
echo "================================================"
echo "hostname,domain,type,ip"
for app in "${apps[@]}"; do
    hostname="$app"
    if [ -n "${aliases[$app]}" ]; then
        hostname="${aliases[$app]}"
    fi
    echo "$hostname,$DOMAIN,A,$INGRESS_IP"
done
