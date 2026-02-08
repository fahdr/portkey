# Simplified Talos Migration - Clean Cutover with Downtime

**Scenario**: No critical apps, full cluster downtime acceptable
**Timeline**: 1-2 days
**Approach**: Wipe all nodes, deploy Talos on all 4 nodes simultaneously, restore from backups

> **Note**: For a production zero-downtime migration, see [k3s-to-talos-migration.md](k3s-to-talos-migration.md)

## Overview

Since you have no critical apps running and can tolerate downtime, we can take the fastest approach:

1. **Backup everything** (VolSync, etcd, configs)
2. **Wipe all K3s nodes** (metal0, metal1, metal2)
3. **Deploy Talos to all 4 nodes** simultaneously (including new rivendell/metal3)
4. **Bootstrap 4-node Talos cluster** (3 control plane + 1 worker)
5. **Restore applications** via ArgoCD

**Total Time**: 4-6 hours (mostly waiting for downloads/installs)

---

## Pre-Migration Checklist

### ✅ Backup Everything

```bash
# 1. Verify all VolSync backups are recent
kubectl get replicationsource -A -o custom-columns=\
NAME:.metadata.name,\
NAMESPACE:.metadata.namespace,\
LAST_SYNC:.status.lastSyncTime

# 2. Trigger final backups for all critical data
for app in vaultwarden homeassistant grocy immich-postgres paperless babybuddy; do
  namespace=$(kubectl get replicationsource -A | grep $app | awk '{print $1}')
  kubectl annotate -n $namespace replicationsource/$app \
    volsync.backube/trigger-backup="final-$(date +%s)"
done

# 3. Wait for all backups to complete (~10-15 minutes)
kubectl get replicationsource -A -w

# 4. Export K3s etcd snapshot
k3s etcd-snapshot save --name pre-talos-migration-$(date +%F)

# 5. Copy etcd snapshot to safe location
scp root@192.168.0.11:/var/lib/rancher/k3s/server/db/snapshots/pre-talos-*.zip \
  ~/backups/

# 6. Export kubeconfig
cp /workspaces/portkey/metal/kubeconfig.yaml ~/backups/kubeconfig-k3s-backup.yaml

# 7. Export critical secrets
kubectl get secret argocd-initial-admin-secret -n argocd -o yaml > ~/backups/argocd-secret.yaml
kubectl get secret cloudflare-api-token -n cert-manager -o yaml > ~/backups/cloudflare-secret.yaml

# 8. Export list of all deployed apps (for verification later)
kubectl get applications -n argocd -o yaml > ~/backups/argocd-apps.yaml
```

### ✅ Document Current State

```bash
# Save current cluster info
kubectl get nodes -o wide > ~/backups/k3s-nodes.txt
kubectl get pvc -A > ~/backups/k3s-pvcs.txt
kubectl get svc -A | grep LoadBalancer > ~/backups/k3s-loadbalancers.txt
kubectl get ingress -A > ~/backups/k3s-ingresses.txt
```

### ✅ Snapshot VMs (Optional - for emergency rollback)

In Proxmox UI, snapshot metal0, metal1, metal2 (before wiping).

---

## Migration Procedure

### Step 1: Create Rivendell VM

```bash
cd /workspaces/portkey/metal

# Set Proxmox credentials
export PROXMOX_HOST="192.168.0.2"
export PROXMOX_USER="root@pam"
export PROXMOX_TOKEN_ID="your-token-id"
export PROXMOX_TOKEN_SECRET="your-token-secret"

# Create metal3 (rivendell) VM
ansible-playbook -i inventories/talos.yml playbooks/talos-provision-vm.yml --limit metal3

# Verify VM created
ssh root@192.168.0.202 "qm list | grep 114"
```

**Expected**: VM 114 (metal3) created and running Talos on rivendell.

### Step 2: Shutdown K3s Cluster

```bash
# Stop K3s on all nodes
for node in 192.168.0.11 192.168.0.12 192.168.0.13; do
  ssh root@$node "systemctl stop k3s && systemctl disable k3s"
done

# Verify K3s stopped
kubectl get nodes
# Should fail to connect - cluster is down
```

**K3s cluster is now DOWN. Apps are inaccessible.**

### Step 3: Wipe All Nodes for Talos

Since you want a clean slate, we'll completely wipe and reinstall all nodes with Talos.

**Option A: Use Existing VMs (Recommended - Faster)**

Simply apply Talos configs to existing VMs (Talos will wipe and take over):

```bash
# Apply Talos config to all 4 nodes simultaneously
ansible-playbook -i inventories/talos.yml playbooks/talos-configure.yml

# This will:
# - Generate Talos machine configs
# - Apply to metal0, metal1, metal2, metal3
# - Nodes will reboot and apply Talos (~3-5 minutes)
```

**Option B: Recreate VMs from Scratch (Optional - Cleanest)**

If you want to completely recreate VMs:

```bash
# Delete old VMs in Proxmox UI (metal0, metal1, metal2)
# Then provision all 4 nodes with Talos:
ansible-playbook -i inventories/talos.yml playbooks/talos-provision-vm.yml
ansible-playbook -i inventories/talos.yml playbooks/talos-configure.yml
```

### Step 4: Verify Talos Nodes Ready

```bash
# Wait for all nodes to finish rebooting (~5 minutes)
sleep 300

# Verify all 4 nodes accessible via Talos API
export TALOSCONFIG=/workspaces/portkey/metal/talos-configs/talosconfig

for node in 192.168.0.11 192.168.0.12 192.168.0.13 192.168.0.14; do
  echo "Checking $node..."
  talosctl --nodes $node version
done

# All nodes should return Talos version v1.9.4
```

### Step 5: Bootstrap Talos Cluster

```bash
# Bootstrap etcd and install Cilium
ansible-playbook -i inventories/talos.yml playbooks/talos-bootstrap.yml

# This will:
# - Bootstrap etcd on metal2 (first control plane)
# - Install Cilium CNI
# - Apply L2 LoadBalancer configuration
# - Export kubeconfig

# Wait for bootstrap to complete (~10 minutes)
```

### Step 6: Verify Cluster Health

```bash
# Set kubeconfig for Talos cluster
export KUBECONFIG=/workspaces/portkey/metal/kubeconfig-talos.yaml

# Check all nodes Ready
kubectl get nodes
# Expected: 4 nodes, all Ready
# - metal0, metal1, metal2: control-plane (Ready)
# - metal3: worker (Ready)

# Check Cilium healthy
kubectl get pods -n kube-system -l app.kubernetes.io/name=cilium-agent
# Expected: 4 pods Running

# Verify etcd cluster (3 members)
talosctl --nodes 192.168.0.11 etcd members
# Expected: metal0, metal1, metal2 listed

# Check LoadBalancer pool
kubectl get ciliumloadbalancerippool
# Expected: default pool with 192.168.0.160/27 (temporary)
```

**Talos cluster is now UP and healthy! 🎉**

### Step 7: Deploy Storage Infrastructure

#### Deploy Rook Ceph (External Cluster)

```bash
# Rook secrets need to be recreated (we can't copy from K3s anymore)
# If you have Rook secrets backed up from K3s:
kubectl apply -f ~/backups/rook-ceph-secrets/

# Or deploy Rook and it will auto-discover the external Ceph cluster
# (Assuming Ceph mon IPs are in system/rook-ceph/values.yaml)
helm install --create-namespace --namespace rook-ceph rook-ceph \
  /workspaces/portkey/system/rook-ceph/

# Wait for Rook operator
kubectl wait --for=condition=Ready pod -l app=rook-ceph-operator \
  -n rook-ceph --timeout=5m

# Test Ceph RBD PVC
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: test-rbd
  namespace: default
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 1Gi
  storageClassName: ceph-block
EOF

kubectl get pvc test-rbd -w
# Should bind within 30 seconds
kubectl delete pvc test-rbd
```

#### Deploy NFS CSI Driver

```bash
helm install nfs-csi /workspaces/portkey/system/nfs-csi/ --namespace kube-system

# Test NFS PVC
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: test-nfs
  namespace: default
spec:
  accessModes: [ReadWriteMany]
  resources:
    requests:
      storage: 1Gi
  storageClassName: nfs-csi
EOF

kubectl get pvc test-nfs -w
kubectl delete pvc test-nfs
```

### Step 8: Deploy ArgoCD

```bash
# Deploy ArgoCD
kubectl create namespace argocd
helm install argocd /workspaces/portkey/bootstrap/root/ --namespace argocd

# Wait for ArgoCD ready
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=argocd-server \
  -n argocd --timeout=10m

# Get admin password
kubectl get secret argocd-initial-admin-secret -n argocd \
  -o jsonpath='{.data.password}' | base64 -d
echo ""

# Access ArgoCD (temporary port-forward)
kubectl port-forward svc/argocd-server -n argocd 8080:443 &
# Open https://localhost:8080

# Or wait for ingress to get LoadBalancer IP
kubectl get svc -n ingress-nginx
```

### Step 9: Restore Applications

ArgoCD will automatically sync all apps from Git. However, stateful apps need their data restored from VolSync backups.

#### Restore Stateless Apps (Automatic)

ArgoCD will automatically deploy these:
- Speedtest, Pairdrop, Excalidraw, Homepage
- ESPHome, Navidrome
- All other stateless apps

```bash
# Sync all apps
kubectl get applications -n argocd

# Or manually trigger sync for specific app
kubectl patch application speedtest -n argocd \
  -p '{"spec":{"syncPolicy":{"automated":null}}}' --type=merge
kubectl patch application speedtest -n argocd \
  -p '{"operation":{"initiatedBy":{"username":"admin"},"sync":{"revision":"HEAD"}}}' --type=merge
```

#### Restore Stateful Apps (Manual - VolSync Restore)

For each stateful app with VolSync backup:

**Example: Vaultwarden**

```bash
# 1. Create namespace
kubectl create namespace vaultwarden

# 2. Restore VolSync secret (if you backed it up)
# If you have the secret backed up from K3s:
kubectl apply -f ~/backups/vaultwarden-volsync-secret.yaml

# Or create new ReplicationDestination pointing to existing backup
kubectl apply -f - <<EOF
apiVersion: volsync.backube/v1alpha1
kind: ReplicationDestination
metadata:
  name: vaultwarden-restore
  namespace: vaultwarden
spec:
  trigger:
    manual: restore-$(date +%s)
  restic:
    repository: vaultwarden-volsync-secret
    destinationPVC: vaultwarden
    accessModes: [ReadWriteOnce]
    capacity: 5Gi
    storageClassName: ceph-block
    # Restic repository details from original backup
    # (you'll need the repository URL and password from original secret)
EOF

# 3. Wait for restore
kubectl wait --for=condition=Completed \
  replicationdestination/vaultwarden-restore -n vaultwarden --timeout=15m

# 4. Deploy app via ArgoCD
kubectl apply -f /workspaces/portkey/apps/vaultwarden/

# 5. Verify data
kubectl exec -n vaultwarden deployment/vaultwarden -- ls /data
```

**Repeat for all stateful apps**:
- vaultwarden
- homeassistant
- grocy
- paperless
- babybuddy
- immich (PostgreSQL data)

**Apps with NFS mounts** (no restore needed):
- immich (library at /nfs/immich)
- nextcloud (data at /nfs/nextcloud)
- jellyfin (media at /nfs/jellyfin)

These will automatically work once deployed - NFS data is preserved.

### Step 10: Deploy Infrastructure Services

```bash
# Deploy cert-manager (for TLS)
helm install cert-manager /workspaces/portkey/system/cert-manager/ \
  --namespace cert-manager --create-namespace

# Deploy ingress-nginx
helm install ingress-nginx /workspaces/portkey/system/ingress-nginx/ \
  --namespace ingress-nginx --create-namespace

# Deploy external-dns
helm install external-dns /workspaces/portkey/system/external-dns/ \
  --namespace external-dns --create-namespace

# Deploy monitoring stack
helm install kube-prometheus-stack /workspaces/portkey/system/monitoring-system/ \
  --namespace monitoring-system --create-namespace
```

### Step 11: Update LoadBalancer IP Pool to Production Range

```bash
# Switch from temporary (.160/27) to production (.224/27)
kubectl apply -f - <<EOF
apiVersion: cilium.io/v2alpha1
kind: CiliumLoadBalancerIPPool
metadata:
  name: default
spec:
  blocks:
    - cidr: 192.168.0.224/27  # Production range
EOF

# Restart ingress-nginx to get new IP
kubectl rollout restart deployment/ingress-nginx-controller -n ingress-nginx

# Wait for new LoadBalancer IP
kubectl get svc -n ingress-nginx ingress-nginx-controller
# Note EXTERNAL-IP (should be in .224-.255 range)
```

### Step 12: Update DNS

Update CloudFlare DNS to point to new ingress IP:
- `*.themainfreak.com` → new LoadBalancer IP
- Or let external-dns handle automatically (if configured)

### Step 13: Verify All Applications

```bash
# Check all apps deployed
kubectl get applications -n argocd

# Check all apps healthy
kubectl get pods -A | grep -v Running

# Check ingresses
kubectl get ingress -A

# Test critical apps
curl -k https://vaultwarden.themainfreak.com
curl -k https://immich.themainfreak.com
curl -k https://homeassistant.themainfreak.com
```

---

## Post-Migration Cleanup

### Update Kubeconfig

```bash
cd /workspaces/portkey/metal

# Backup K3s kubeconfig
mv kubeconfig.yaml kubeconfig-k3s-backup.yaml

# Make Talos kubeconfig default
ln -sf kubeconfig-talos.yaml kubeconfig.yaml

# Update KUBECONFIG env var
echo "export KUBECONFIG=/workspaces/portkey/metal/kubeconfig-talos.yaml" >> ~/.bashrc
source ~/.bashrc
```

### Clean Up K3s Residual Files (Optional)

```bash
# Remove K3s files from nodes
for node in 192.168.0.11 192.168.0.12 192.168.0.13; do
  ssh root@$node "rm -rf /var/lib/rancher/k3s /etc/rancher"
done
```

### Update Documentation

- [x] CLUSTER.md - Update migration status to "Complete"
- [ ] Update metal/README.md with Talos as primary
- [ ] Add Talos learnings to MEMORY.md

---

## Verification Checklist

### Cluster Health
- [ ] All 4 nodes Ready (metal0, metal1, metal2, metal3)
- [ ] etcd cluster healthy (3 members)
- [ ] Cilium pods Running on all nodes
- [ ] LoadBalancer IP pool configured (.224/27)

### Storage
- [ ] Rook Ceph operator Running
- [ ] Ceph RBD StorageClass available
- [ ] CephFS StorageClass available
- [ ] NFS CSI driver installed
- [ ] Test PVCs can be created and bound

### Networking
- [ ] Ingress controller Running
- [ ] LoadBalancer IPs assigned
- [ ] DNS resolving to new ingress IP
- [ ] Cert-manager issuing certificates

### Applications
- [ ] ArgoCD deployed and accessible
- [ ] All stateless apps Running
- [ ] Stateful apps restored from VolSync
- [ ] NFS-backed apps can access data
- [ ] All ingresses returning 200 OK

### Infrastructure
- [ ] Monitoring stack (Prometheus, Grafana) Running
- [ ] Logging (Loki) Running
- [ ] VolSync backups configured and running
- [ ] External-DNS updating DNS records

---

## Rollback Plan

### If Migration Fails Catastrophically

Since you wiped K3s, rollback requires VM snapshots:

```bash
# 1. Restore all VMs from Proxmox snapshots
# (Proxmox UI → VMs → Snapshots → Restore)

# 2. Start VMs

# 3. Restart K3s on all nodes
for node in 192.168.0.11 192.168.0.12 192.168.0.13; do
  ssh root@$node "systemctl start k3s"
done

# 4. Verify K3s cluster
export KUBECONFIG=~/backups/kubeconfig-k3s-backup.yaml
kubectl get nodes
kubectl get pods -A

# 5. All apps should come back automatically via ArgoCD
```

**Rollback Time**: ~30 minutes

---

## Timeline Estimate

| Task | Duration |
|------|----------|
| Pre-migration backups | 30 min |
| Create rivendell VM | 10 min |
| Shutdown K3s, apply Talos configs | 15 min |
| Wait for Talos nodes ready | 5 min |
| Bootstrap Talos cluster | 10 min |
| Deploy storage (Rook, NFS CSI) | 15 min |
| Deploy ArgoCD | 10 min |
| Deploy infrastructure (ingress, cert-manager, etc.) | 20 min |
| Restore stateful apps from VolSync | 1-2 hours |
| Deploy all other apps | 30 min |
| Update DNS and verify | 30 min |
| **Total** | **4-6 hours** |

---

## Key Differences from Rolling Migration

| Aspect | Rolling Migration | Clean Cutover (This Doc) |
|--------|------------------|--------------------------|
| **Downtime** | Near-zero | Full cluster downtime (4-6 hours) |
| **Duration** | 4-5 weeks | 1 day |
| **Complexity** | High (5 phases, gradual app migration) | Low (single clean cutover) |
| **Risk** | Low (rollback at each phase) | Medium (requires VM snapshots for rollback) |
| **K3s Cluster** | Kept running during migration | Wiped immediately |
| **App Migration** | Per-app, gradual | All at once via ArgoCD |
| **Rollback** | Per-phase or per-app | Full cluster restore from snapshots |
| **Best For** | Production with critical apps | Dev/staging or non-critical clusters |

---

## Next Steps

1. **Read through this entire guide**
2. **Run pre-migration backups** (Step 1)
3. **Set Proxmox API credentials**
4. **Execute migration** (Steps 1-13)
5. **Verify cluster health** (Checklist)
6. **Celebrate!** 🎉

**When ready to start**: Begin with Step 1 (Create Rivendell VM)

---

**Last Updated**: 2026-02-08
**Status**: 🟢 Ready for execution
**Estimated Downtime**: 4-6 hours
