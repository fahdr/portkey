#!/bin/bash
set -e

# Script to clean up feature app deployments
# Usage: ./cleanup-feature-app.sh <app-name> [branch-name] [suffix] [--force]

APP_NAME="${1}"
BRANCH_NAME="${2:-}"
SUFFIX="${3:-}"
FORCE_CLEANUP=false

# Check for --force flag in any position
for arg in "$@"; do
    case $arg in
        --force)
            FORCE_CLEANUP=true
            shift
            ;;
    esac
done

if [ -z "$APP_NAME" ]; then
    echo "Usage: $0 <app-name> [branch-name] [suffix] [--force]"
    echo "Example: $0 nextcloud feature/new-config"
    echo "Example: $0 nextcloud '' mysuffix  # cleanup with suffix"
    echo "Example: $0 nextcloud feature/new-config '' --force  # force cleanup"
    echo ""
    echo "Available test applications:"
    kubectl get applications -n argocd -l app.kubernetes.io/instance=dev --no-headers -o custom-columns=NAME:.metadata.name 2>/dev/null || echo "No test applications found"
    exit 1
fi

# Sanitize inputs for Kubernetes naming
SANITIZED_BRANCH=""
SANITIZED_SUFFIX=""
if [ -n "$BRANCH_NAME" ]; then
    SANITIZED_BRANCH=$(echo "${BRANCH_NAME}" | sed 's/[^a-zA-Z0-9]/-/g' | tr '[:upper:]' '[:lower:]')
fi
if [ -n "$SUFFIX" ]; then
    SANITIZED_SUFFIX=$(echo "${SUFFIX}" | sed 's/[^a-zA-Z0-9]/-/g' | tr '[:upper:]' '[:lower:]')
fi

# Determine app instance name and namespace
if [ -n "$SANITIZED_SUFFIX" ]; then
    if [ -n "$SANITIZED_BRANCH" ]; then
        APP_INSTANCE="dev-${APP_NAME}-${SANITIZED_SUFFIX}-${SANITIZED_BRANCH}"
    else
        APP_INSTANCE="dev-${APP_NAME}-${SANITIZED_SUFFIX}"
    fi
    NAMESPACE="dev-${APP_NAME}-${SANITIZED_SUFFIX}"
elif [ -n "$SANITIZED_BRANCH" ]; then
    APP_INSTANCE="dev-${APP_NAME}-${SANITIZED_BRANCH}"
    NAMESPACE="dev-${APP_NAME}"
else
    # If no branch or suffix specified, try to find and list matching apps
    echo "Searching for test applications for app: $APP_NAME"
    MATCHING_APPS=$(kubectl get applications -n argocd -l app.kubernetes.io/name="$APP_NAME",app.kubernetes.io/instance=dev --no-headers -o custom-columns=NAME:.metadata.name 2>/dev/null || echo "")
    
    if [ -z "$MATCHING_APPS" ]; then
        echo "No test applications found for app: $APP_NAME"
        exit 1
    fi
    
    echo "Found the following test applications:"
    echo "$MATCHING_APPS"
    echo ""
    echo "Please specify a branch name or suffix to clean up a specific deployment"
    echo "Or use one of these commands:"
    for app in $MATCHING_APPS; do
        echo "  kubectl delete application -n argocd $app"
    done
    exit 1
fi

echo "Cleaning up test deployment..."
echo "App: $APP_NAME"
echo "Application instance: $APP_INSTANCE"
echo "Namespace: $NAMESPACE"
if [ "$FORCE_CLEANUP" = true ]; then
    echo "⚠️  Force cleanup enabled - will remove finalizers if needed"
fi
echo ""

# Delete the ArgoCD application
if kubectl get application "$APP_INSTANCE" -n argocd >/dev/null 2>&1; then
    echo "Deleting ArgoCD application: $APP_INSTANCE"
    
    if [ "$FORCE_CLEANUP" = true ]; then
        echo "Removing finalizers from application..."
        kubectl patch application "$APP_INSTANCE" -n argocd --type json --patch='[{"op": "remove", "path": "/metadata/finalizers"}]' 2>/dev/null || true
    fi
    
    kubectl delete application "$APP_INSTANCE" -n argocd --timeout=60s
    echo "✅ Application deleted"
else
    echo "⚠️  Application $APP_INSTANCE not found"
fi

# Function to force cleanup namespace
force_cleanup_namespace() {
    local namespace="$1"
    echo "⚠️  Applying force cleanup to namespace: $namespace"
    
    # Remove finalizers from persistent volume claims
    echo "Cleaning up PVCs..."
    kubectl get pvc -n "$namespace" -o name 2>/dev/null | while read -r pvc; do
        echo "  Removing finalizers from $pvc"
        kubectl patch "$pvc" -n "$namespace" --type json --patch='[{"op": "remove", "path": "/metadata/finalizers"}]' 2>/dev/null || true
    done
    
    # Remove finalizers from persistent volumes that belong to this namespace
    echo "Cleaning up PVs..."
    kubectl get pv -o name 2>/dev/null | while read -r pv; do
        pv_namespace=$(kubectl get "$pv" -o jsonpath='{.spec.claimRef.namespace}' 2>/dev/null || echo "")
        if [ "$pv_namespace" = "$namespace" ]; then
            echo "  Removing finalizers from $pv"
            kubectl patch "$pv" --type json --patch='[{"op": "remove", "path": "/metadata/finalizers"}]' 2>/dev/null || true
        fi
    done
    
    # Remove finalizers from other common resources
    echo "Cleaning up other resources..."
    for resource in secrets configmaps services deployments statefulsets replicasets daemonsets jobs cronjobs pods persistentvolumeclaims; do
        kubectl get "$resource" -n "$namespace" -o name 2>/dev/null | while read -r res; do
            if [ -n "$res" ]; then
                echo "  Removing finalizers from $res"
                kubectl patch "$res" -n "$namespace" --type json --patch='[{"op": "remove", "path": "/metadata/finalizers"}]' 2>/dev/null || true
            fi
        done
    done
    
    # Remove finalizer from namespace itself
    echo "Removing finalizers from namespace..."
    kubectl patch namespace "$namespace" --type json --patch='[{"op": "remove", "path": "/metadata/finalizers"}]' 2>/dev/null || true
    
    # Force delete any remaining pods
    echo "Force deleting remaining pods..."
    kubectl delete pods --all -n "$namespace" --force --grace-period=0 2>/dev/null || true
    
    echo "Force cleanup completed"
}

# Delete the namespace
if kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
    echo "Deleting namespace: $NAMESPACE"
    
    if [ "$FORCE_CLEANUP" = true ]; then
        # First, try normal deletion with timeout
        echo "Attempting normal deletion first..."
        timeout 60s kubectl delete namespace "$NAMESPACE" 2>/dev/null || {
            echo "Normal deletion timed out or failed, applying force cleanup..."
            force_cleanup_namespace "$NAMESPACE"
        }
    else
        kubectl delete namespace "$NAMESPACE" --timeout=120s
    fi
    
    echo "✅ Namespace deleted"
else
    echo "⚠️  Namespace $NAMESPACE not found"
fi

echo ""
echo "✅ Cleanup completed successfully!"
