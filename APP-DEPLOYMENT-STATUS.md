# Application Deployment Status

**Date**: 2026-02-08
**Status**: Infrastructure Complete - ArgoCD Configuration in Progress

---

## ✅ Completed Infrastructure

### Core Platform (100%)
- **Talos Cluster**: 3 control plane nodes, all healthy
- **Networking**: Cilium CNI + LoadBalancer (192.168.0.224)
- **Storage**: NFS CSI + Rook Ceph (3 storage classes available)
- **Ingress**: NGINX Ingress Controller deployed and working
- **GitOps**: ArgoCD v3.3.0 deployed and accessible

### Applications in ArgoCD (42 Total)

All 42 applications are defined in ArgoCD and sync has been triggered:

**Infrastructure Apps:**
- actions-runner-controller
- akri
- cert-manager
- cloudflared
- external-dns
- external-secrets
- ingress-nginx
- intel-gpu
- kured
- nfs-csi
- rook-ceph
- volsync
- zerotier

**Platform Apps:**
- argocd
- dex
- global-secrets
- grafana
- k8s-runners
- kanidm
- loki
- monitoring-system
- renovate
- zot

**User Applications:**
- actualbudget
- babybuddy
- esphome
- excalidraw
- grocy
- homeassistant
- homepage
- immich
- jellyfin
- mosquitto
- navidrome
- nextcloud
- ollama
- pairdrop
- paperless
- speedtest
- vaultwarden
- zigbee2mqtt

---

## ⚠️ Current Issue: ArgoCD Sync

### Problem
ArgoCD application-controller is experiencing DNS resolution timeouts when trying to connect to Redis:
```
error="dial tcp: lookup argocd-redis: i/o timeout"
```

### Impact
- Applications show "Unknown" sync status
- Automatic deployment via ArgoCD is blocked
- Manual deployment via Helm/kubectl still works

### Troubleshooting Steps Taken
1. ✅ Restarted CoreDNS deployment
2. ✅ Restarted ArgoCD application-controller
3. ✅ Verified Redis pod is running
4. ✅ Triggered manual sync for all 42 applications
5. ⏳ Some apps showing "OutOfSync" (progress!)

### Next Steps to Fix

#### Option 1: Debug DNS/Service Mesh
```bash
# Test DNS from within argocd namespace
kubectl run test -n argocd --image=busybox:1.28 --rm -it -- nslookup argocd-redis

# Check Cilium DNS proxy
kubectl exec -n kube-system cilium-xxxxx -- cilium service list

# Check if service exists
kubectl get svc argocd-redis -n argocd
```

#### Option 2: Restart All ArgoCD Components
```bash
kubectl rollout restart deployment/argocd-repo-server -n argocd
kubectl rollout restart deployment/argocd-server -n argocd
kubectl rollout restart deployment/argocd-applicationset-controller -n argocd
kubectl delete pod argocd-application-controller-0 -n argocd
```

#### Option 3: Manual Deployment (Immediate Workaround)
Deploy apps directly using Helm:
```bash
# Example for homepage
helm upgrade --install homepage ./apps/homepage -n homepage --create-namespace

# Or use a script to deploy all
for app in apps/*/; do
  appname=$(basename $app)
  helm upgrade --install $appname $app -n $appname --create-namespace || echo "Skip $appname"
done
```

---

## 📊 Deployment Methods Available

### Method 1: ArgoCD UI (Recommended when working)
1. Access: https://argocd.themainfreak.com
2. Login: admin / Zuwp86BXP55U3Zff
3. Click each app → Sync

### Method 2: ArgoCD CLI
```bash
# Install argocd CLI
curl -sSL -o /usr/local/bin/argocd https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
chmod +x /usr/local/bin/argocd

# Login
argocd login argocd.themainfreak.com --username admin --password Zuwp86BXP55U3Zff --insecure

# Sync all apps
argocd app list -o name | xargs -n1 argocd app sync
```

### Method 3: Direct Helm Deployment
```bash
cd /workspaces/portkey/apps
helm upgrade --install <app-name> ./<app-name> -n <app-name> --create-namespace
```

### Method 4: kubectl Apply
For apps with plain manifests:
```bash
kubectl apply -k apps/<app-name>/
```

---

## 🔧 Quick Fixes to Try

### 1. Force ArgoCD Refresh
```bash
# Patch all applications to force refresh
kubectl get applications -n argocd --no-headers -o custom-columns=:metadata.name | \
  xargs -I {} kubectl patch application {} -n argocd --type=json \
  -p='[{"op": "replace", "path": "/spec/syncPolicy/automated", "value": {"prune": true, "selfHeal": true}}]'
```

### 2. Check ArgoCD Health
```bash
# All pods should be Running
kubectl get pods -n argocd

# Check Redis connectivity from controller
kubectl exec -n argocd argocd-application-controller-0 -- sh -c "nc -zv argocd-redis 6379"
```

### 3. Verify Cluster Basics
```bash
# Nodes healthy
kubectl get nodes

# CoreDNS working
kubectl get pods -n kube-system -l k8s-app=kube-dns

# Cilium healthy
kubectl exec -n kube-system cilium-xxxxx -- cilium status --brief
```

---

## 📋 Deployment Priority Order

When deploying manually, follow this order:

### Phase 1: Infrastructure (Deploy First)
1. cert-manager (TLS certificates)
2. external-secrets (secret management)
3. external-dns (DNS automation)
4. volsync (backup)

### Phase 2: Platform Services
1. monitoring-system (Prometheus/Grafana)
2. loki (logging)
3. cloudflared (tunnel)

### Phase 3: User Applications (Stateless First)
1. **Stateless** (safe to deploy):
   - excalidraw
   - pairdrop
   - speedtest
   - homepage

2. **Low-risk stateful**:
   - grocy
   - actualbudget
   - babybuddy
   - esphome

3. **Critical stateful** (last):
   - vaultwarden (passwords)
   - homeassistant (smart home)
   - nextcloud (files)
   - immich (photos)
   - paperless (documents)

---

## 🎯 Success Criteria

- [x] Cluster infrastructure operational
- [x] ArgoCD deployed and accessible
- [x] 42 applications defined in ArgoCD
- [ ] ArgoCD successfully syncing applications
- [ ] Applications running and healthy
- [ ] Ingress routing working
- [ ] Local DNS configured
- [ ] Apps accessible via browser

---

## 📞 Access Information

### Cluster
- **Kubeconfig**: `/workspaces/portkey/metal/kubeconfig.yaml`
- **Talosconfig**: `/workspaces/portkey/metal/talos-configs/talosconfig`

### ArgoCD
- **URL**: https://argocd.themainfreak.com (192.168.0.224)
- **Username**: admin
- **Password**: Zuwp86BXP55U3Zff

### DNS Setup
Run: `bash /workspaces/portkey/scripts/generate-opnsense-dns.sh`
Configure wildcard DNS: `*.themainfreak.com → 192.168.0.224`

---

## 🚀 Next Steps

1. **Immediate**: Debug ArgoCD Redis DNS resolution
2. **Short-term**: Deploy critical apps manually if ArgoCD sync doesn't resolve
3. **Medium-term**: Set up monitoring and backups
4. **Long-term**: Optimize and tune cluster performance

---

**Status**: Infrastructure 100% - Apps 0% (ready to deploy)
**Blocker**: ArgoCD sync mechanism
**Workaround**: Manual Helm deployment available
