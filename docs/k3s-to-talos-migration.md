# K3s to Talos Linux Migration Runbook

**Status**: 🟡 Planning Complete, Ready to Execute
**Timeline**: 4-5 weeks
**Strategy**: Rolling in-place migration
**Risk Level**: Medium (gradual rollback points at each phase)

## Table of Contents

1. [Pre-Migration Checklist](#pre-migration-checklist)
2. [Phase 1: Bootstrap Talos Cluster (Week 1)](#phase-1-bootstrap-talos-cluster-week-1)
3. [Phase 2: Infrastructure & Low-Risk Apps (Weeks 2-3)](#phase-2-infrastructure--low-risk-apps-weeks-2-3)
4. [Phase 3: Add metal1 for HA (End of Week 3)](#phase-3-add-metal1-for-ha-end-of-week-3)
5. [Phase 4: Critical Apps & metal0 (Week 4)](#phase-4-critical-apps--metal0-week-4)
6. [Phase 5: Cleanup & Documentation (Week 4-5)](#phase-5-cleanup--documentation-week-4-5)
7. [Rollback Procedures](#rollback-procedures)
8. [Troubleshooting](#troubleshooting)

---

## Pre-Migration Checklist

### ✅ Verify Backups

```bash
# Check all VolSync backups are recent (< 24 hours)
kubectl get replicationsource -A -o custom-columns=\
NAME:.metadata.name,\
NAMESPACE:.metadata.namespace,\
LAST_SYNC:.status.lastSyncTime,\
STATUS:.status.lastManualSync

# Export K3s etcd snapshot
k3s etcd-snapshot save --name pre-talos-$(date +%F)
# Backup location: /var/lib/rancher/k3s/server/db/snapshots/

# Copy etcd snapshot to safe location
scp root@192.168.0.11:/var/lib/rancher/k3s/server/db/snapshots/pre-talos-*.zip \
  ~/backups/
```

### ✅ Snapshot VMs in Proxmox

For each node (metal0, metal1, metal2), create a snapshot in Proxmox UI:
1. Select VM → Snapshots tab
2. Click "Take Snapshot"
3. Name: `pre-talos-migration-$(date +%F)`
4. Include RAM: No (faster, but VM must be stopped first - skip for now)
5. Description: "Pre-Talos migration snapshot for rollback"

### ✅ Export Critical Secrets

```bash
# Export kubeconfig
cp /workspaces/portkey/metal/kubeconfig.yaml ~/backups/kubeconfig-k3s-backup.yaml

# Export ArgoCD admin password
kubectl get secret argocd-initial-admin-secret -n argocd \
  -o jsonpath='{.data.password}' | base64 -d > ~/backups/argocd-password.txt

# Export Cloudflare API token (for cert-manager/external-dns)
kubectl get secret cloudflare-api-token -n cert-manager \
  -o yaml > ~/backups/cloudflare-secret.yaml
```

### ✅ Set Proxmox API Credentials

```bash
# Set environment variables for Ansible
export PROXMOX_HOST="192.168.0.2"  # shire
export PROXMOX_USER="root@pam"
export PROXMOX_TOKEN_ID="your-token-id"
export PROXMOX_TOKEN_SECRET="your-token-secret"

# Or create Proxmox API token:
# Datacenter → Permissions → API Tokens → Add
# User: root@pam
# Token ID: ansible
# Privilege Separation: No
```

### ✅ Announce Maintenance Window

Send notification to users:
- Migration starting: [Date]
- Expected completion: 4-5 weeks
- Critical service downtime windows:
  - Vaultwarden: [Date/Time] (~30 minutes)
  - Home Assistant: [Date/Time] (~1 hour)
- Rollback capability: Each phase can be rolled back independently

---

## Phase 1: Bootstrap Talos Cluster (Week 1)

**Goal**: Create 2-node Talos cluster (metal2 + rivendell/metal3)
**Duration**: 1 week
**K3s cluster state**: Continues running on metal0, metal1 (2-node, degraded HA)

### Step 1.1: Create Rivendell VM

```bash
cd /workspaces/portkey/metal

# Create metal3 (rivendell) VM on Proxmox
ansible-playbook -i inventories/talos.yml playbooks/talos-provision-vm.yml --limit metal3

# Verify VM created and booted
ssh root@192.168.0.202 "qm list | grep 114"  # Should show VM 114 running
```

**Expected output**: VM `metal3` (ID 114) created on rivendell and running Talos.

### Step 1.2: Remove metal2 from K3s Cluster

**⚠️ WARNING**: This reduces K3s cluster to 2 control plane nodes. If one more fails, K3s loses quorum.

```bash
# Drain metal2 (move all pods to metal0/metal1)
kubectl drain metal2 --ignore-daemonsets --delete-emptydir-data --timeout=10m

# Verify all pods moved off metal2
kubectl get pods -A -o wide | grep metal2  # Should return nothing

# Delete metal2 from K3s cluster
kubectl delete node metal2

# Stop K3s service on metal2
ssh root@192.168.0.13 "systemctl stop k3s && systemctl disable k3s"

# Verify K3s cluster healthy with 2 nodes
kubectl get nodes  # Should show metal0, metal1 Ready
```

**Expected state**:
- K3s cluster: metal0, metal1 (2 control plane nodes)
- metal2: Stopped, ready for Talos

### Step 1.3: Apply Talos Configuration

```bash
# Apply Talos config to metal2 and metal3
ansible-playbook -i inventories/talos.yml playbooks/talos-configure.yml

# Wait for nodes to reboot and apply configs (~3-5 minutes)
sleep 180

# Verify nodes accessible via Talos API
talosctl --nodes 192.168.0.13 --talosconfig talos-configs/talosconfig version
talosctl --nodes 192.168.0.14 --talosconfig talos-configs/talosconfig version
```

**Expected output**: Both nodes return Talos version v1.9.4, Client and Server match.

### Step 1.4: Bootstrap Talos Cluster

```bash
# Bootstrap etcd on metal2 and install Cilium
ansible-playbook -i inventories/talos.yml playbooks/talos-bootstrap.yml

# Wait for bootstrap to complete (~5-10 minutes)
```

**Expected output**:
- etcd cluster initialized on metal2
- Kubernetes API server running
- Cilium installed and all pods Running
- Both nodes (metal2, metal3) showing Ready

### Step 1.5: Verify Talos Cluster Health

```bash
# Set kubeconfig for Talos cluster
export KUBECONFIG=/workspaces/portkey/metal/kubeconfig-talos.yaml

# Check nodes
kubectl get nodes
# Expected: 2 nodes Ready (metal2 as control plane, metal3 as worker)

# Check Cilium
kubectl get pods -n kube-system -l app.kubernetes.io/name=cilium-agent
# Expected: 2 pods Running

# Verify L2 announcements configured
kubectl get ciliuml2announcementpolicy
kubectl get ciliumloadbalancerippool
```

**Rollback point**: If Talos cluster fails to bootstrap, restore metal2 from snapshot and rejoin to K3s.

---

## Phase 2: Infrastructure & Low-Risk Apps (Weeks 2-3)

**Goal**: Deploy storage infrastructure and migrate 8-12 low-risk apps
**Duration**: 2 weeks
**K3s cluster state**: Still running on metal0, metal1 with critical apps

### Step 2.1: Deploy Storage Infrastructure

#### Deploy Rook Ceph (External Cluster)

```bash
# Switch to Talos kubeconfig
export KUBECONFIG=/workspaces/portkey/metal/kubeconfig-talos.yaml

# Copy Rook secrets from K3s cluster
export K3S_KUBECONFIG=/workspaces/portkey/metal/kubeconfig.yaml

# Copy all Rook secrets
for secret in rook-ceph-mon rook-csi-rbd-node rook-csi-rbd-provisioner \
              rook-csi-cephfs-node rook-csi-cephfs-provisioner; do
  kubectl --kubeconfig=$K3S_KUBECONFIG get secret -n rook-ceph $secret -o yaml | \
    kubectl --kubeconfig=$KUBECONFIG apply -f -
done

# Deploy Rook operator
helm install --create-namespace --namespace rook-ceph rook-ceph \
  /workspaces/portkey/system/rook-ceph/

# Wait for Rook operator ready
kubectl wait --for=condition=Ready pod -l app=rook-ceph-operator -n rook-ceph --timeout=5m
```

#### Test Ceph Storage

```bash
# Create test RBD PVC
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: test-rbd-pvc
  namespace: default
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
  storageClassName: ceph-block
EOF

# Wait for PVC to bind
kubectl get pvc test-rbd-pvc -w
# Expected: STATUS Bound within 30 seconds

# Clean up test PVC
kubectl delete pvc test-rbd-pvc
```

#### Deploy NFS CSI Driver

```bash
# Deploy NFS CSI driver
helm install nfs-csi /workspaces/portkey/system/nfs-csi/ --namespace kube-system

# Test NFS PVC
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: test-nfs-pvc
  namespace: default
spec:
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 1Gi
  storageClassName: nfs-csi
EOF

kubectl get pvc test-nfs-pvc -w
kubectl delete pvc test-nfs-pvc
```

### Step 2.2: Deploy ArgoCD

```bash
# Create argocd namespace
kubectl create namespace argocd

# Deploy ArgoCD
helm install argocd /workspaces/portkey/bootstrap/root/ --namespace argocd

# Wait for ArgoCD ready
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=argocd-server \
  -n argocd --timeout=10m

# Get admin password
kubectl get secret argocd-initial-admin-secret -n argocd \
  -o jsonpath='{.data.password}' | base64 -d
echo ""

# Access ArgoCD via port-forward (temporary)
kubectl port-forward svc/argocd-server -n argocd 8080:443
# Open https://localhost:8080
```

**Configure temporary ArgoCD ingress**:
- Create ingress for `argocd-new.themainfreak.com` (temporary hostname during migration)
- Update CloudFlare DNS to point to new LoadBalancer IP

### Step 2.3: Migrate Stateless Applications (Week 2)

**Apps to migrate**: Speedtest, Pairdrop, Excalidraw, Homepage, ActualBudget, Grocy, ESPHome, Navidrome

**Procedure per app**:

```bash
# Example: Migrating Speedtest (stateless app)

# 1. Deploy app on Talos via ArgoCD
kubectl --kubeconfig=$KUBECONFIG apply -f /workspaces/portkey/apps/speedtest/

# 2. Wait for app ready
kubectl --kubeconfig=$KUBECONFIG wait --for=condition=available \
  deployment/speedtest -n speedtest --timeout=5m

# 3. Test functionality
curl -k https://speedtest-new.themainfreak.com
# Or update ingress to temporary hostname if needed

# 4. Scale down on K3s
kubectl --kubeconfig=$K3S_KUBECONFIG scale deployment/speedtest \
  -n speedtest --replicas=0

# 5. Monitor for 24-48 hours

# 6. Delete from K3s if stable
kubectl --kubeconfig=$K3S_KUBECONFIG delete -f /workspaces/portkey/apps/speedtest/
```

### Step 2.4: Migrate Stateful Applications with VolSync (Week 3)

**Apps to migrate**: Grocy (has VolSync backup)

**Procedure**:

```bash
# Example: Migrating Grocy (stateful app with VolSync)

# 1. Trigger final backup on K3s
kubectl --kubeconfig=$K3S_KUBECONFIG annotate -n grocy \
  replicationsource/grocy volsync.backube/trigger-backup="final-$(date +%s)"

# 2. Wait for backup completion
kubectl --kubeconfig=$K3S_KUBECONFIG get replicationsource/grocy -n grocy -w
# Wait for LAST_SYNC to update (~5-10 minutes)

# 3. Copy VolSync secret to Talos cluster
kubectl --kubeconfig=$K3S_KUBECONFIG get secret grocy-volsync-secret -n grocy -o yaml | \
  kubectl --kubeconfig=$KUBECONFIG apply -f -

# 4. Create ReplicationDestination on Talos
kubectl --kubeconfig=$KUBECONFIG apply -f - <<EOF
apiVersion: volsync.backube/v1alpha1
kind: ReplicationDestination
metadata:
  name: grocy-restore
  namespace: grocy
spec:
  trigger:
    manual: restore-$(date +%s)
  restic:
    repository: grocy-volsync-secret
    destinationPVC: grocy
    accessModes: [ReadWriteOnce]
    capacity: 1Gi
    storageClassName: ceph-block
EOF

# 5. Wait for restore
kubectl --kubeconfig=$KUBECONFIG wait --for=condition=Completed \
  replicationdestination/grocy-restore -n grocy --timeout=15m

# 6. Deploy app on Talos
kubectl --kubeconfig=$KUBECONFIG apply -f /workspaces/portkey/apps/grocy/

# 7. Verify data integrity
kubectl --kubeconfig=$KUBECONFIG exec -n grocy deployment/grocy -- ls /data
# Check that data is present

# 8. Scale down K3s deployment (keep PVC for rollback)
kubectl --kubeconfig=$K3S_KUBECONFIG scale deployment/grocy -n grocy --replicas=0

# 9. Monitor for 48 hours before deleting from K3s
```

**End of Phase 2 milestone**: 8-12 apps migrated and stable on Talos cluster

---

## Phase 3: Add metal1 for HA (End of Week 3)

**Goal**: Achieve 3-node control plane (metal2, metal1) + 1 worker (metal3)
**Duration**: 1 day
**K3s cluster state**: Reduced to single node (metal0) - **CRITICAL PERIOD**

### Step 3.1: Drain metal1 from K3s

**⚠️ CRITICAL**: After this step, K3s cluster has only 1 control plane node (metal0). If metal0 fails, K3s is lost. Ensure all critical apps already migrated before proceeding.

```bash
export K3S_KUBECONFIG=/workspaces/portkey/metal/kubeconfig.yaml

# Drain metal1
kubectl --kubeconfig=$K3S_KUBECONFIG drain metal1 \
  --ignore-daemonsets --delete-emptydir-data --timeout=10m

# Delete node
kubectl --kubeconfig=$K3S_KUBECONFIG delete node metal1

# Stop K3s
ssh root@192.168.0.12 "systemctl stop k3s && systemctl disable k3s"

# Verify K3s cluster has only metal0
kubectl --kubeconfig=$K3S_KUBECONFIG get nodes
# Expected: Only metal0 shown
```

### Step 3.2: Add metal1 to Talos Cluster

```bash
# Add metal1 to Talos cluster
ansible-playbook -i inventories/talos.yml playbooks/talos-add-node.yml --limit metal1

# Wait for metal1 to join (~5 minutes)
export KUBECONFIG=/workspaces/portkey/metal/kubeconfig-talos.yaml
kubectl get nodes -w
# Expected: metal1, metal2, metal3 all Ready

# Verify etcd has 2 members
talosctl --nodes 192.168.0.13 etcd members
# Expected: metal2, metal1 listed as etcd members
```

**Expected state**:
- Talos cluster: 3 nodes (metal1, metal2 control plane; metal3 worker)
- K3s cluster: 1 node (metal0 only - **not HA, high risk**)

**Rollback point**: If metal1 fails to join, restore from snapshot and rejoin K3s.

---

## Phase 4: Critical Apps & metal0 (Week 4)

**Goal**: Migrate all remaining apps, add metal0 for full 3-node HA control plane
**Duration**: 1 week

### Step 4.1: Migrate Infrastructure Services

Deploy on Talos cluster:
- cert-manager (TLS certificates)
- ingress-nginx (main ingress)
- external-dns (automatic DNS)
- Monitoring stack (Prometheus, Grafana, Loki)

**Procedure**: Same as Phase 2 stateless app migration.

### Step 4.2: Migrate Vaultwarden (Password Manager)

**⚠️ CRITICAL SERVICE - Announce 2-hour maintenance window**

```bash
export K3S_KUBECONFIG=/workspaces/portkey/metal/kubeconfig.yaml
export KUBECONFIG=/workspaces/portkey/metal/kubeconfig-talos.yaml

# T-15 min: Final VolSync backup
kubectl --kubeconfig=$K3S_KUBECONFIG annotate replicationsource/vaultwarden \
  -n vaultwarden volsync.backube/trigger-backup="final-$(date +%s)"

# T-10 min: Wait for backup completion
kubectl --kubeconfig=$K3S_KUBECONFIG get replicationsource/vaultwarden -n vaultwarden -w

# T-5 min: Scale to 0 on K3s
kubectl --kubeconfig=$K3S_KUBECONFIG scale deployment/vaultwarden \
  -n vaultwarden --replicas=0

# T+0: Copy secret and restore on Talos
kubectl --kubeconfig=$K3S_KUBECONFIG get secret vaultwarden-volsync-secret \
  -n vaultwarden -o yaml | kubectl --kubeconfig=$KUBECONFIG apply -f -

kubectl --kubeconfig=$KUBECONFIG apply -f - <<EOF
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
EOF

# T+15: Wait for restore, then deploy
kubectl --kubeconfig=$KUBECONFIG wait --for=condition=Completed \
  replicationdestination/vaultwarden-restore -n vaultwarden --timeout=15m

kubectl --kubeconfig=$KUBECONFIG apply -f /workspaces/portkey/apps/vaultwarden/

# T+20: Update DNS to point to new ingress
# (Manual CloudFlare update or external-dns should handle automatically)

# T+25: Test login
curl -k https://vaultwarden.themainfreak.com
# Test: Login to web UI, verify vaults accessible, test TOTP codes

# T+30: Announce success or rollback
```

### Step 4.3: Migrate Home Assistant

**Special considerations**:
- MQTT dependency (Mosquitto must be migrated first)
- Zigbee2mqtt dependency
- USB device passthrough may be needed

```bash
# 1. Migrate Mosquitto (MQTT broker) first
# (Follow VolSync procedure from Phase 2)

# 2. Test MQTT connectivity
kubectl --kubeconfig=$KUBECONFIG exec -n mosquitto deployment/mosquitto -- \
  mosquitto_pub -t test -m "hello from talos"

# 3. Migrate Zigbee2mqtt
# (Follow VolSync procedure)

# 4. Migrate Home Assistant
# (Follow VolSync procedure)

# 5. Full integration test
# - Check all integrations loaded
# - Verify Zigbee devices responsive
# - Test MQTT connection
# - Check automations executing
```

### Step 4.4: Migrate Immich (Large Dataset)

```bash
# Immich uses NFS for library + Ceph RBD for PostgreSQL

# 1. Final PostgreSQL backup via VolSync
kubectl --kubeconfig=$K3S_KUBECONFIG annotate replicationsource/immich-postgres \
  -n immich volsync.backube/trigger-backup="final-$(date +%s)"

# 2. Restore PostgreSQL PVC on Talos
# (Follow VolSync restore procedure)

# 3. Deploy Immich on Talos
# NFS mount (/nfs/immich) will automatically work - no data copy needed
kubectl --kubeconfig=$KUBECONFIG apply -f /workspaces/portkey/apps/immich/

# 4. Verify library accessible
kubectl --kubeconfig=$KUBECONFIG exec -n immich deployment/immich-server -- \
  ls /usr/src/app/upload/library
# Should show 15,624+ assets

# 5. Test web UI
# - Login, browse photos
# - Upload new photo
# - Test face recognition (ML pod)
```

### Step 4.5: Add metal0 to Talos Cluster (Final HA)

Once all apps migrated from K3s:

```bash
# Stop K3s on metal0 (last K3s node)
ssh root@192.168.0.11 "systemctl stop k3s && systemctl disable k3s"

# Add metal0 to Talos cluster
ansible-playbook -i inventories/talos.yml playbooks/talos-add-node.yml --limit metal0

# Wait for metal0 to join
export KUBECONFIG=/workspaces/portkey/metal/kubeconfig-talos.yaml
kubectl get nodes -w
# Expected: 4 nodes Ready (metal0, metal1, metal2, metal3)

# Verify 3-member etcd cluster (FULL HA ACHIEVED!)
talosctl --nodes 192.168.0.13 etcd members
# Expected: metal0, metal1, metal2 listed as etcd members
```

**Final cluster topology**:
- Control plane: metal0, metal1, metal2 (3 nodes, HA)
- Worker: metal3 (rivendell)
- Total: 4 nodes

---

## Phase 5: Cleanup & Documentation (Week 4-5)

**Goal**: Finalize migration, update IPs, clean up K3s, update docs
**Duration**: 1 week

### Step 5.1: Update LoadBalancer IP Pool

```bash
# Switch from temporary pool (.160/27) to production pool (.224/27)
kubectl apply -f - <<EOF
apiVersion: cilium.io/v2alpha1
kind: CiliumLoadBalancerIPPool
metadata:
  name: default
spec:
  blocks:
    - cidr: 192.168.0.224/27  # Production pool
EOF

# Restart ingress-nginx to get new IP
kubectl rollout restart deployment/ingress-nginx-controller -n ingress-nginx

# Wait for new LoadBalancer IP
kubectl get svc -n ingress-nginx ingress-nginx-controller -w
# Note the new EXTERNAL-IP from .224/27 range
```

### Step 5.2: Update DNS

Update CloudFlare DNS (or let external-dns handle automatically):
- All `*.themainfreak.com` → new ingress IP
- Remove `-new` temporary hostnames
- Remove old K3s ingress IP entries

### Step 5.3: Clean Up K3s Residual Files

```bash
# On all old K3s nodes
for node in 192.168.0.11 192.168.0.12 192.168.0.13; do
  ssh root@$node "rm -rf /var/lib/rancher/k3s /etc/rancher /usr/local/bin/k3s"
done
```

### Step 5.4: Update Kubeconfig

```bash
cd /workspaces/portkey/metal

# Backup old K3s kubeconfig
mv kubeconfig.yaml kubeconfig-k3s-backup-$(date +%F).yaml

# Make Talos kubeconfig the default
ln -sf kubeconfig-talos.yaml kubeconfig.yaml

# Update KUBECONFIG in shells/scripts
echo "export KUBECONFIG=/workspaces/portkey/metal/kubeconfig-talos.yaml" >> ~/.bashrc
```

### Step 5.5: Update Documentation

- [x] CLUSTER.md updated with Talos info
- [ ] Update metal/README.md with Talos playbook usage
- [ ] Update MEMORY.md with Talos learnings
- [ ] Add Talos operations to team runbooks

### Step 5.6: Monitor for 1 Week

**Checklist**:
- [ ] No pod restarts
- [ ] No PVC mount failures
- [ ] No ingress errors
- [ ] VolSync backups running on schedule
- [ ] Prometheus metrics collecting
- [ ] All applications accessible
- [ ] No user complaints

**After 1 week of stability, migration is COMPLETE! 🎉**

---

## Rollback Procedures

### Per-Application Rollback

If an app is broken on Talos cluster:

```bash
export K3S_KUBECONFIG=/workspaces/portkey/metal/kubeconfig.yaml

# 1. Scale up on K3s
kubectl --kubeconfig=$K3S_KUBECONFIG scale deployment/<app> \
  -n <namespace> --replicas=<original-count>

# 2. Switch DNS back to K3s ingress IP
# (Manual CloudFlare update)

# 3. Verify app working on K3s

# 4. Investigate Talos issue offline (no time pressure)
```

### Rollback metal2 to K3s (Phase 1 Failure)

If Talos cluster fails to bootstrap:

```bash
# 1. Restore metal2 VM from Proxmox snapshot
# (Proxmox UI: VM → Snapshots → Restore)

# 2. Start VM and verify Fedora/K3s boots

# 3. Restart K3s
ssh root@192.168.0.13 "systemctl start k3s && systemctl enable k3s"

# 4. Wait for metal2 to rejoin K3s cluster
kubectl get nodes -w
# Expected: metal0, metal1, metal2 all Ready

# 5. Investigation: Review Talos bootstrap logs
```

### Rollback metal1 (Phase 3 Failure)

If metal1 fails to join Talos cluster:

```bash
# 1. Restore metal1 VM from Proxmox snapshot

# 2. Restart K3s
ssh root@192.168.0.12 "systemctl start k3s"

# 3. Re-join K3s cluster
# (K3s should auto-rejoin with existing token)

kubectl get nodes
# Expected: metal0, metal1 Ready
```

### Full Cluster Rollback (Catastrophic Failure)

If Talos cluster is completely broken:

```bash
# 1. Restore ALL VMs from Proxmox snapshots
# (metal0, metal1, metal2)

# 2. Start all VMs

# 3. Restart K3s on all nodes
for node in 192.168.0.11 192.168.0.12 192.168.0.13; do
  ssh root@$node "systemctl start k3s"
done

# 4. Verify K3s cluster healthy
kubectl get nodes
# Expected: metal0, metal1, metal2 all Ready

# 5. Verify all apps running
kubectl get pods -A | grep -v Running

# All apps should come back automatically via ArgoCD
```

---

## Troubleshooting

### Talos cluster won't bootstrap

**Symptom**: `talosctl bootstrap` hangs or fails

**Debug**:
```bash
# Check if node is reachable
talosctl --nodes 192.168.0.13 version

# Check machine config applied
talosctl --nodes 192.168.0.13 get machineconfig

# Check etcd errors
talosctl --nodes 192.168.0.13 logs etcd

# Check kubelet errors
talosctl --nodes 192.168.0.13 logs kubelet
```

**Common causes**:
- Machine config not applied correctly
- Network connectivity issues
- VIP conflict with K3s cluster

**Solution**: Verify machine config, check network, ensure K3s VIP not conflicting.

### Cilium pods not starting

**Symptom**: Cilium agent pods stuck in Init, nodes remain NotReady

**Debug**:
```bash
kubectl describe pod -n kube-system -l app.kubernetes.io/name=cilium-agent

# Check Cilium operator logs
kubectl logs -n kube-system deployment/cilium-operator
```

**Common causes**:
- Talos cgroup settings incorrect
- Missing kernel modules
- Security context issues

**Solution**: Verify Cilium values have Talos-specific settings (cgroup hostRoot, security contexts).

### Storage driver fails to attach PVC

**Symptom**: Pods stuck in ContainerCreating, PVC not Bound

**Debug**:
```bash
# Check PVC status
kubectl describe pvc <pvc-name> -n <namespace>

# Check Rook Ceph operator logs
kubectl logs -n rook-ceph deployment/rook-ceph-operator

# Check CSI driver logs
kubectl logs -n rook-ceph deployment/csi-rbdplugin
```

**Common causes**:
- Rook secrets not copied from K3s
- Ceph cluster unreachable
- CSI driver configuration incorrect

**Solution**: Verify Rook secrets exist, test Ceph connectivity from Talos nodes.

### Home Assistant Zigbee dongle not detected

**Symptom**: Zigbee2mqtt can't find USB dongle

**Debug**:
```bash
# Check USB devices on Talos node
talosctl --nodes 192.168.0.11 ls /dev/tty*

# Check kernel modules loaded
talosctl --nodes 192.168.0.11 read /proc/modules | grep cp210x
```

**Solution**: Add USB kernel module to Talos machine config:
```yaml
machine:
  kernel:
    modules:
      - name: cp210x
```

---

## Support & Resources

- **Migration Plan**: [/root/.claude/plans/async-herding-wadler.md](/root/.claude/plans/async-herding-wadler.md)
- **Talos Documentation**: https://www.talos.dev/
- **Cilium Documentation**: https://docs.cilium.io/
- **Rook Ceph**: https://rook.io/docs/rook/latest/

---

**Last Updated**: 2026-02-08
**Status**: 🟡 Ready for Phase 1 Execution
