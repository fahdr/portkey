# Talos Cluster Deployment Complete

## Cluster Overview

**Deployed:** 2026-02-08  
**Status:** ✅ Fully Operational

### Infrastructure

- **3 Control Plane Nodes**
  - metal0 (192.168.0.11) - mirkwood VM 106
  - metal1 (192.168.0.12) - rohan VM 107  
  - metal2 (192.168.0.13) - gondor VM 104
  
- **OS:** Talos Linux v1.12.3
- **Kubernetes:** v1.35.0
- **Control Plane VIP:** 192.168.0.100

### Networking

- **CNI:** Cilium v1.17.4 (kube-proxy replacement)
- **Pod CIDR:** 10.0.1.0/8
- **Service CIDR:** 10.43.0.0/16
- **LoadBalancer IP Pool:** 192.168.0.224/27
- **Ingress Controller:** NGINX (192.168.0.224)

### Storage

- **NFS CSI:** ✅ Deployed (storage class: nfs-csi)
  - NFS Server: 192.168.0.41:/nfs/k8s
- **Rook Ceph:** ⚠️ Requires external cluster secrets

### GitOps Platform

- **ArgoCD:** ✅ Running
  - URL: https://argocd.themainfreak.com (192.168.0.224)
  - Username: admin
  - Password: Zuwp86BXP55U3Zff
  - All pods healthy (7/7)

## Access Instructions

### kubectl Access

```bash
export KUBECONFIG=/workspaces/portkey/metal/kubeconfig.yaml
kubectl get nodes
```

### talosctl Access

```bash
export TALOSCONFIG=/workspaces/portkey/metal/talos-configs/talosconfig
talosctl --nodes 192.168.0.11 dashboard
talosctl health
```

### ArgoCD Access

1. **Via Web UI:**
   - URL: https://argocd.themainfreak.com
   - Username: admin
   - Password: Zuwp86BXP55U3Zff

2. **Via CLI (if installed):**
   ```bash
   argocd login argocd.themainfreak.com
   argocd app list
   ```

## Next Steps

### 1. Configure Rook Ceph (Optional)

If you want to use the external Ceph cluster:

```bash
# Copy secrets from old K3s cluster or run import script
cd /workspaces/portkey/bootstrap/root
# Follow .cephrc configuration
bash apply.sh
```

### 2. Deploy Applications via ArgoCD

```bash
# Deploy the root ApplicationSet to bootstrap all apps
cd /workspaces/portkey/bootstrap/root
bash apply.sh
```

This will create ApplicationSets that automatically deploy:
- System infrastructure (monitoring, logging, etc.)
- Platform services
- Applications

### 3. Update DNS

Update your DNS records to point to the new ingress IP:
- `*.themainfreak.com` → 192.168.0.224

Or update your local `/etc/hosts` for testing:
```
192.168.0.224 argocd.themainfreak.com
```

### 4. Test Storage

Test NFS CSI storage:

```bash
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: test-nfs
spec:
  accessModes: [ReadWriteMany]
  resources:
    requests:
      storage: 1Gi
  storageClassName: nfs-csi
