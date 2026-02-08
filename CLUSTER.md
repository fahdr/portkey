# Portkey Cluster Architecture

> **✅ MIGRATION COMPLETE**: Cluster successfully migrated to Talos Linux on 2026-02-08.
>
> **Deployment Details**: See [metal/TALOS-DEPLOYMENT.md](metal/TALOS-DEPLOYMENT.md) for complete setup documentation.
>
> **Migration Guides** (for reference):
> - **[Simplified](docs/talos-migration-simplified.md)**: Clean cutover approach (used for this migration)
> - **[Production/Zero-Downtime](docs/k3s-to-talos-migration.md)**: Rolling migration approach

## Overview

This is a 3-node bare-metal Kubernetes cluster running **Talos Linux v1.12.3** with **Kubernetes v1.35.0** on Proxmox VMs.

**Key Features**:
- Immutable, API-driven infrastructure
- Cilium CNI with kube-proxy replacement
- External Ceph storage + NFS
- GitOps with ArgoCD

## Nodes

| Node | Role | Resources | IP | Proxmox Host | VM ID |
|------|------|-----------|-----|--------------|-------|
| metal0 | Control Plane | 4 CPU, 44GB RAM | 192.168.0.11 | mirkwood | 106 |
| metal1 | Control Plane | 4 CPU, 27GB RAM | 192.168.0.12 | rohan | 107 |
| metal2 | Control Plane | 4 CPU, 27GB RAM | 192.168.0.13 | gondor | 104 |

**Control Plane VIP**: 192.168.0.100 (Talos built-in VIP)

### GPU Access Notes

**Intel N100 (metal1, metal2)**:
- VM GPU passthrough works reliably using Intel GVT-g or direct passthrough
- Using `intel-device-plugins-operator` for `gpu.intel.com/i915` resource

**AMD Ryzen 5 4500U (mirkwood/metal0)**:
- ⚠️ **VM GPU Passthrough**: Not recommended due to AMD APU reset bug and IOMMU grouping issues
- ✅ **LXC Alternative**: Can create LXC container (metal3) with native GPU access
- See [docs/lxc-kubernetes-node.md](docs/lxc-kubernetes-node.md) for LXC setup guide

## External Dependencies

### Ceph Storage (Critical)
- **Location**: Proxmox cluster at 192.168.0.x
- **Usage**: All persistent volumes via `ceph-block` StorageClass
- **Recovery**: If Ceph is unavailable, pods will hang in `ContainerCreating`
- **Monitoring**: Check `rook-ceph` namespace pods and `kubectl get cephcluster -n rook-ceph`

### NFS Storage
- **Server**: 192.168.0.41
- **Path**: `/nfs/plex`, `/nfs/k8s`, `/nfs/nextcloud`
- **Usage**: Jellyfin media, Nextcloud data
- **Recovery**: Mount NFS manually or check server availability

## Critical Services

### Password Manager (Vaultwarden)
- **Backup**: Every 6 hours via Volsync
- **PV Reclaim Policy**: Retain
- **Recovery**: Restore from Restic backup in `vaultwarden-volsync-secret`

### Home Automation Stack
All on metal0 (intentional - Zigbee dongle location):
- homeassistant
- mosquitto (MQTT)
- zigbee2mqtt

**Risk**: Single node failure takes down home automation
**Backup**: Daily via Volsync

### Media Stack (Jellyfin)
- jellyfin (GPU transcoding)
- transmission, radarr, sonarr, prowlarr, lidarr, jellyseerr
- Depends on NFS for media files

## Backup Strategy

| App | Frequency | Method | Retention |
|-----|-----------|--------|-----------|
| vaultwarden | Every 6 hours | Volsync/Restic | 7 days |
| homeassistant | Daily | Volsync/Restic | 7 days |
| paperless | Daily | Volsync/Restic | 7 days |
| zigbee2mqtt | Daily | Volsync/Restic | 7 days |
| mosquitto | Daily | Volsync/Restic | 7 days |
| grocy | Daily | Volsync/Restic | 7 days |
| babybuddy | Daily | Volsync/Restic | 7 days |

## Recovery Procedures

### Node Failure
1. Pods will be rescheduled to remaining nodes (except those with node affinity)
2. RWO volumes will need ~6 minutes to detach and reattach
3. Monitor with `kubectl get pods -A -o wide | grep -v Running`

### Ceph Failure
1. All ceph-block PVCs will be unavailable
2. Pods will hang in ContainerCreating
3. Check Proxmox Ceph dashboard
4. Once restored, pods will auto-recover

### Complete Cluster Recovery
1. Restore nodes from Proxmox templates/backups
2. Bootstrap cluster with `kubeadm`
3. Apply ArgoCD bootstrap
4. ArgoCD will restore all applications from Git
5. Restore data from Volsync backups

## Monitoring

- **Prometheus**: `monitoring-system` namespace
- **Grafana**: https://grafana.themainfreak.com
- **Alertmanager**: Alerts via ntfy.sh

## Maintenance

### Node Drain
```bash
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data
# Perform maintenance
kubectl uncordon <node>
```

### Certificate Renewal
Handled automatically by cert-manager with Let's Encrypt.

### Image Updates
Renovate bot creates PRs for image updates. Manual merge required.

## Known Issues

1. **metal1 memory overcommit**: Memory limits at ~96%, monitor for OOM
2. **Renovate authentication**: Check GitHub token if jobs fail
3. **zigbee2mqtt restarts**: May restart if MQTT broker (mosquitto) restarts first
4. **AMD GPU on mirkwood**: AMD Ryzen 5 4500U iGPU cannot be passed through to VMs reliably (reset bug + IOMMU issues). Use LXC container for GPU workloads instead.

## Expansion Options

### Adding GPU Capacity

**Option 1: LXC Container on Mirkwood (Recommended)**
- Create privileged LXC container with device passthrough
- Native AMD GPU access without VM overhead
- Suitable for ML workloads (Immich, Ollama)
- Guide: [docs/lxc-kubernetes-node.md](docs/lxc-kubernetes-node.md)
- Script: `scripts/create-lxc-k8s-node.sh`

**Option 2: Discrete GPU in Mirkwood**
- Add low-power GPU (NVIDIA GT 1030, AMD RX 6400)
- Passthrough to VM more reliable than iGPU
- Leaves iGPU for Proxmox console

**Option 3: More Intel N100 Nodes**
- Intel iGPU passthrough proven to work (metal1/metal2)
- Consistent experience across nodes

---

## Talos Migration Plan

### Migration Strategy

The cluster is being migrated from K3s (Fedora 39) to **Talos Linux** using a **rolling in-place** approach:

1. **Phase 1** (Week 1): Convert metal2 to Talos + add rivendell (metal3) → 2-node Talos cluster
2. **Phase 2** (Weeks 2-3): Deploy infrastructure and migrate low-risk applications
3. **Phase 3** (Week 3): Convert metal1 to Talos → 3-node cluster (HA control plane achieved)
4. **Phase 4** (Week 4): Migrate critical apps, convert metal0 → 4-node final cluster
5. **Phase 5** (Week 4-5): Cleanup, update IP pools, documentation

**Total Duration**: 4-5 weeks with gradual, safe cutover

### Target Cluster Configuration

#### Nodes (After Migration)

| Node | Hostname | IP | Role | Resources | Proxmox Host |
|------|----------|-----|------|-----------|--------------|
| metal0 | mirkwood | 192.168.0.11 | Control Plane | 4 CPU, 26GB RAM | mirkwood (AMD Ryzen 5 4500U) |
| metal1 | rohan | 192.168.0.12 | Control Plane | 4 CPU, 26GB RAM | rohan (Intel N100) |
| metal2 | gondor | 192.168.0.13 | Control Plane | 4 CPU, 26GB RAM | gondor (Intel N100) |
| **metal3** | **rivendell** | **192.168.0.14** | **Worker** | **4 CPU, 10GB RAM** | **rivendell** |

**New**: metal3 (rivendell) added as worker node

#### Talos Linux Benefits

- **Immutable OS**: No SSH access, API-driven configuration
- **Security**: Minimal attack surface, automatic updates
- **Declarative**: Full cluster config in YAML
- **Built-in VIP**: No kube-vip pod needed
- **GitOps-friendly**: Machine configs in version control

### Networking (After Migration)

- **Control Plane VIP**: 192.168.0.100 (Talos built-in VIP)
- **CNI**: Cilium 1.17.4 (kube-proxy replacement, same as K3s)
- **Pod CIDR**: 10.0.1.0/8 (unchanged)
- **Service CIDR**: 10.43.0.0/16 (unchanged)
- **LoadBalancer Pool**: 192.168.0.224/27 (Cilium L2 announcements, unchanged)
- **Ingress**: NGINX Ingress Controller (unchanged)

### Storage (Unchanged)

- **Ceph RBD**: Default storage class (external Proxmox Ceph cluster)
- **CephFS**: Shared filesystem (Proxmox-managed MDS)
- **NFS**: 192.168.0.41:/nfs/k8s (Shire ZFS array)

All existing PVCs and data will be preserved during migration.

### Ansible Automation

New Talos provisioning playbooks in `metal/playbooks/`:

```bash
# Create rivendell VM
ansible-playbook -i inventories/talos.yml playbooks/talos-provision-vm.yml --limit metal3

# Apply Talos configuration to nodes
ansible-playbook -i inventories/talos.yml playbooks/talos-configure.yml

# Bootstrap new Talos cluster
ansible-playbook -i inventories/talos.yml playbooks/talos-bootstrap.yml

# Add node to existing cluster
ansible-playbook -i inventories/talos.yml playbooks/talos-add-node.yml --limit metal1
```

### Talos Operations (After Migration)

#### Access the cluster

```bash
# Set kubeconfig
export KUBECONFIG=/workspaces/portkey/metal/kubeconfig-talos.yaml

# Set talosconfig
export TALOSCONFIG=/workspaces/portkey/metal/talos-configs/talosconfig
```

#### Common talosctl commands

```bash
# Interactive dashboard
talosctl --nodes 192.168.0.11 dashboard

# Check cluster health
talosctl --nodes 192.168.0.11,192.168.0.12,192.168.0.13 health

# View logs
talosctl --nodes 192.168.0.11 logs kubelet
talosctl --nodes 192.168.0.11 logs etcd
talosctl --nodes 192.168.0.11 dmesg

# Check etcd cluster
talosctl --nodes 192.168.0.11 etcd members
talosctl --nodes 192.168.0.11 etcd status

# Upgrade Talos
talosctl --nodes 192.168.0.11,192.168.0.12,192.168.0.13,192.168.0.14 upgrade \
  --image ghcr.io/siderolabs/installer:v1.10.0 --preserve

# Upgrade Kubernetes
talosctl --nodes 192.168.0.11,192.168.0.12,192.168.0.13 upgrade-k8s --to 1.34.0
```

### Migration Status

- [ ] **Phase 1**: Bootstrap Talos cluster (metal2 + metal3/rivendell)
- [ ] **Phase 2**: Deploy infrastructure (storage, ArgoCD, monitoring)
- [ ] **Phase 2**: Migrate stateless & low-risk apps (8-12 apps)
- [ ] **Phase 3**: Add metal1 to Talos cluster (achieve HA)
- [ ] **Phase 4**: Migrate critical apps (Vaultwarden, Home Assistant, Immich)
- [ ] **Phase 4**: Add metal0 to Talos cluster (final 4-node cluster)
- [ ] **Phase 5**: Decommission K3s, update documentation

**Current Phase**: Planning & Ansible automation complete

### Rollback Plan

- VM snapshots in Proxmox before each phase
- VolSync backups verified current before migration
- K3s cluster kept running until all apps migrated
- Per-app rollback: scale up on K3s, switch DNS back
- Full rollback: restore VMs from snapshots, restart K3s

For detailed migration procedures, see [docs/k3s-to-talos-migration.md](docs/k3s-to-talos-migration.md)
