#!/bin/bash
set -e

# Nuclear cleanup script for stuck test deployments
# Usage: ./force-cleanup-all-test-apps.sh [--confirm]

CONFIRM="${1:-}"

if [ "$CONFIRM" != "--confirm" ]; then
    echo "⚠️  WARNING: This script will FORCE DELETE ALL test applications and namespaces!"
    echo ""
    echo "This includes:"
    echo "- All ArgoCD applications with label app.kubernetes.io/instance=dev"
    echo "- All namespaces starting with 'dev-'"
    echo "- All associated resources (PVCs, PVs, etc.)"
    echo ""
    echo "Current test applications:"
    kubectl get applications -n argocd -l app.kubernetes.io/instance=dev --no-headers -o custom-columns=NAME:.metadata.name 2>/dev/null || echo "No test applications found"
    echo ""
    echo "Current dev namespaces:"
    kubectl get namespaces --no-headers -o custom-columns=NAME:.metadata.name | grep "^dev-" || echo "No dev namespaces found"
    echo ""
    echo "To proceed, run: $0 --confirm"
    exit 1
fi

echo "🧹 Starting nuclear cleanup of all test deployments..."

# Force delete all test applications
echo "Deleting all test ArgoCD applications..."
kubectl get applications -n argocd -l app.kubernetes.io/instance=dev -o name 2>/dev/null | while read -r app; do
    if [ -n "$app" ]; then
        echo "  Force deleting $app"
        kubectl patch "$app" -n argocd --type json --patch='[{"op": "remove", "path": "/metadata/finalizers"}]' 2>/dev/null || true
        kubectl delete "$app" -n argocd --force --grace-period=0 2>/dev/null || true
    fi
done

# Force delete all dev namespaces
echo "Force deleting all dev namespaces..."
kubectl get namespaces --no-headers -o custom-columns=NAME:.metadata.name | grep "^dev-" | while read -r namespace; do
    if [ -n "$namespace" ]; then
        echo "  Force cleaning namespace: $namespace"
        
        # Remove finalizers from all resources in the namespace
        for resource in secrets configmaps services deployments statefulsets replicasets daemonsets jobs cronjobs pods persistentvolumeclaims; do
            kubectl get "$resource" -n "$namespace" -o name 2>/dev/null | while read -r res; do
                if [ -n "$res" ]; then
                    kubectl patch "$res" -n "$namespace" --type json --patch='[{"op": "remove", "path": "/metadata/finalizers"}]' 2>/dev/null || true
                fi
            done
        done
        
        # Force delete all pods
        kubectl delete pods --all -n "$namespace" --force --grace-period=0 2>/dev/null || true
        
        # Remove namespace finalizers and force delete
        kubectl patch namespace "$namespace" --type json --patch='[{"op": "remove", "path": "/metadata/finalizers"}]' 2>/dev/null || true
        kubectl delete namespace "$namespace" --force --grace-period=0 2>/dev/null || true
    fi
done

# Clean up orphaned PVs that might be left behind
echo "Cleaning up orphaned persistent volumes..."
kubectl get pv -o name 2>/dev/null | while read -r pv; do
    pv_namespace=$(kubectl get "$pv" -o jsonpath='{.spec.claimRef.namespace}' 2>/dev/null || echo "")
    if [[ "$pv_namespace" =~ ^dev- ]]; then
        echo "  Removing finalizers from orphaned $pv"
        kubectl patch "$pv" --type json --patch='[{"op": "remove", "path": "/metadata/finalizers"}]' 2>/dev/null || true
        kubectl delete "$pv" --force --grace-period=0 2>/dev/null || true
    fi
done

echo ""
echo "✅ Nuclear cleanup completed!"
echo ""
echo "Remaining test applications:"
kubectl get applications -n argocd -l app.kubernetes.io/instance=dev --no-headers -o custom-columns=NAME:.metadata.name 2>/dev/null || echo "None"
echo ""
echo "Remaining dev namespaces:"
kubectl get namespaces --no-headers -o custom-columns=NAME:.metadata.name | grep "^dev-" || echo "None"
