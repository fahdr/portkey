#!/bin/bash
set -e

# Script to deploy a specific app from a feature branch for testing
# Usage: ./deploy-feature-app.sh <app-name> <branch-name> [suffix]

APP_NAME="${1}"
BRANCH_NAME="${2}"
SUFFIX="${3:-}"

if [ -z "$APP_NAME" ] || [ -z "$BRANCH_NAME" ]; then
    echo "Usage: $0 <app-name> <branch-name> [suffix]"
    echo "Example: $0 nextcloud feature/new-config"
    echo "Example: $0 nextcloud feature/new-config mysuffix"
    echo ""
    echo "Available apps:"
    ls -1 apps/ 2>/dev/null | grep -v "^Chart\|^values" || echo "No apps found"
    exit 1
fi

# Validate app exists
if [ ! -d "apps/$APP_NAME" ]; then
    echo "❌ App '$APP_NAME' not found in apps/ directory"
    echo "Available apps:"
    ls -1 apps/ | grep -v "^Chart\|^values" || echo "No apps found"
    exit 1
fi

# Sanitize inputs for Kubernetes naming
SANITIZED_BRANCH=$(echo "${BRANCH_NAME}" | sed 's/[^a-zA-Z0-9]/-/g' | tr '[:upper:]' '[:lower:]')
SANITIZED_SUFFIX=$(echo "${SUFFIX}" | sed 's/[^a-zA-Z0-9]/-/g' | tr '[:upper:]' '[:lower:]')

# Determine app instance name and namespace
if [ -n "$SUFFIX" ]; then
    APP_INSTANCE="dev-${APP_NAME}-${SANITIZED_SUFFIX}-${SANITIZED_BRANCH}"
    NAMESPACE="dev-${APP_NAME}-${SANITIZED_SUFFIX}"
else
    APP_INSTANCE="dev-${APP_NAME}-${SANITIZED_BRANCH}"
    NAMESPACE="dev-${APP_NAME}"
fi

echo "🚀 Deploying app: $APP_NAME from branch: $BRANCH_NAME"
echo "📦 Application instance: $APP_INSTANCE"
echo "🏠 Namespace: $NAMESPACE"

# Create the Application manifest
cat <<EOF | kubectl apply -f -
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: ${APP_INSTANCE}
  namespace: argocd
  labels:
    app.kubernetes.io/name: ${APP_NAME}
    app.kubernetes.io/instance: dev
    testing.portkey.io/branch: ${SANITIZED_BRANCH}
  annotations:
    argocd.argoproj.io/compare-options: IgnoreExtraneous
    testing.portkey.io/created-by: local-script
    testing.portkey.io/source-branch: ${BRANCH_NAME}
spec:
  project: default
  source:
    repoURL: https://github.com/fahdr/portkey
    targetRevision: ${BRANCH_NAME}
    path: apps/${APP_NAME}
  destination:
    server: https://kubernetes.default.svc
    namespace: ${NAMESPACE}
  syncPolicy:
    automated:
      prune: false
      selfHeal: false
    syncOptions:
      - CreateNamespace=true
      - ApplyOutOfSyncOnly=true
    retry:
      limit: 5
      backoff:
        duration: 30s
        factor: 2
        maxDuration: 3m
EOF

echo "✅ Application ${APP_INSTANCE} created successfully!"
echo ""
echo "📊 Monitor the deployment with:"
echo "  kubectl get application ${APP_INSTANCE} -n argocd"
echo "  kubectl get all -n ${NAMESPACE}"
echo "  argocd app get ${APP_INSTANCE}"
echo ""
echo "🧹 To clean up when done testing:"
echo "  ./scripts/cleanup-feature-app.sh ${APP_NAME} ${BRANCH_NAME}${SUFFIX:+ $SUFFIX}"
echo "  # Or manually:"
echo "  kubectl delete application ${APP_INSTANCE} -n argocd"
echo "  kubectl delete namespace ${NAMESPACE}"
