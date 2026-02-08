#!/bin/bash
# Deploy all applications to ArgoCD

set -e

REPO_URL="https://github.com/fahdr/portkey"
TARGET_REVISION="master"

echo "========================================="
echo "Deploying all applications to ArgoCD"
echo "========================================="
echo ""

# List of applications
apps=(
    "actualbudget"
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

deployed=0
failed=0

for app in "${apps[@]}"; do
    echo "Deploying $app..."

    # Create ArgoCD Application
    kubectl apply -f - <<EOF
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: $app
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: $REPO_URL
    targetRevision: $TARGET_REVISION
    path: apps/$app
  destination:
    server: https://kubernetes.default.svc
    namespace: $app
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
EOF

    if [ $? -eq 0 ]; then
        echo "✓ $app deployed"
        ((deployed++))
    else
        echo "✗ $app failed"
        ((failed++))
    fi
    echo ""
done

echo "========================================="
echo "Deployment Summary"
echo "========================================="
echo "Deployed: $deployed"
echo "Failed: $failed"
echo "Total: ${#apps[@]}"
echo ""
echo "Check status with:"
echo "  kubectl get applications -n argocd"
echo "  argocd app list"
echo ""
echo "View in ArgoCD UI:"
echo "  https://argocd.themainfreak.com"
