# Portkey Cluster Architecture

> **✅ MIGRATION COMPLETE**: Cluster successfully migrated to Talos Linux on 2026-02-08.
>
> **Deployment Details**: See [metal/TALOS-DEPLOYMENT.md](metal/TALOS-DEPLOYMENT.md) for complete setup documentation.
>
> **Migration Guides** (for reference):
> - **[Simplified](docs/talos-migration-simplified.md)**: Clean cutover approach (used for this migration)
> - **[Production/Zero-Downtime](docs/k3s-to-talos-migration.md)**: Rolling migration approach

## Overview

This is a 4-node Kubernetes cluster running **Talos Linux v1.12.3** with **Kubernetes v1.35.0** on a 7-node Proxmox cluster.

**Key Features**:
- Immutable, API-driven infrastructure
- Cilium CNI with kube-proxy replacement
- External Ceph storage + NFS
- GitOps with ArgoCD
- Intel GPU (i915) via Talos Image Factory system extension
- PodSecurity baseline enforced by default (privileged where needed)

## Proxmox Cluster (7 nodes)

| Host | IP | Notes |
|------|-----|-------|
| shire | 192.168.0.2 | Cluster seed, OPNsense, NFS (8-disk ZFS), Ceph MON |
| rivendell | 192.168.0.202 | K8s worker host, Ceph MON |
| isengard | 192.168.0.102 | Ceph MON |
| mirkwood | 192.168.0.8 | K8s CP host (metal0), AMD Ryzen |
| rohan | 192.168.0.7 | K8s CP host (metal1), Intel |
| gondor | 192.168.0.6 | K8s CP host (metal2), Intel |
| erebor | 192.168.0.101 | New K8s host, NVIDIA GTX 1660 Ti |

## Kubernetes Nodes

| Node | Role | Resources | IP | Proxmox Host | VM ID |
|------|------|-----------|-----|--------------|-------|
| metal0 | Control Plane | 4 CPU, 44GB RAM | 192.168.0.11 | mirkwood | 106 |
| metal1 | Control Plane | 4 CPU, 27GB RAM | 192.168.0.12 | rohan | 107 |
| metal2 | Control Plane | 4 CPU, 27GB RAM | 192.168.0.13 | gondor | 104 |
| metal3 | Worker | 4 CPU, 10GB RAM | 192.168.0.14 | rivendell | 114 |

**Control Plane VIP**: 192.168.0.100 (Talos built-in VIP)

### GPU Access Notes

**Talos GPU Setup**: The default Talos kernel does not include i915. We use [Talos Image Factory](https://factory.talos.dev) with the `i915-ucode` system extension to provide the driver. See [metal/README.md](metal/README.md#system-extensions-image-factory) for details.

**Intel N100 (metal1, metal2)**:
- VM GPU passthrough works reliably via Proxmox PCI passthrough
- i915 loaded via Talos system extension + `machine.kernel.modules` config
- NFD labels nodes with `intel.feature.node.kubernetes.io/gpu=true`
- `intel-device-plugins-operator` provides `gpu.intel.com/i915` resource

**AMD Ryzen 5 4500U (mirkwood/metal0)**:
- VM GPU passthrough not recommended (AMD APU reset bug + IOMMU grouping issues)
- Node still gets i915 extension but no GPU hardware passed through — NFD won't label it
- See [docs/lxc-kubernetes-node.md](docs/lxc-kubernetes-node.md) for LXC alternative

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
2. Run `make` from repo root (deploys: Talos cluster → Ceph secrets + ArgoCD → Terraform secrets)
3. ArgoCD will restore all applications from Git
4. Run `make post-install` for Kanidm OAuth setup
5. Restore data from Volsync backups

See [metal/README.md](metal/README.md) for step-by-step instructions.

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
5. **PodSecurity baseline on Talos**: Talos enforces `baseline` PodSecurity by default. Apps needing host access must have their namespace labeled `privileged`. See [metal/README.md](metal/README.md#podsecurity-talos-specific) for the list of affected apps.
6. **Talos upgrades must use Image Factory**: Using vanilla `ghcr.io/siderolabs/installer` will lose system extensions (i915-ucode). Always use the factory image URL. See [metal/README.md](metal/README.md#upgrade-talos).
7. **StorageClass is immutable**: Kubernetes StorageClass parameters cannot be updated in-place. Must delete and recreate (ArgoCD won't auto-fix).

## Expansion Options

### Erebor — NVIDIA GTX 1660 Ti (In Progress)

Erebor has a dedicated **NVIDIA GeForce GTX 1660 Ti** (TU116, PCI IDs `10de:2182`). This is the first discrete GPU in the cluster, suitable for:
- Ollama / LLM inference
- Immich ML (machine learning photo processing)
- Video transcoding (NVENC)
- General CUDA compute

**Status**: Proxmox node setup complete, GPU passthrough configuration pending.

### Other GPU Options

**LXC Container on Mirkwood** (AMD Ryzen iGPU)
- Native AMD GPU access without VM overhead
- Guide: [docs/lxc-kubernetes-node.md](docs/lxc-kubernetes-node.md)

**Intel N100 Nodes** (metal1/metal2)
- Intel i915 iGPU passthrough proven to work
- Used for Jellyfin transcoding

---

## Migration History

Migration from K3s (Fedora 39) to Talos Linux completed on 2026-02-08. See [MIGRATION-COMPLETE.md](MIGRATION-COMPLETE.md) for details.

Old K3s disks preserved as `unused0` on each Proxmox VM for emergency rollback.

For migration guides (reference only):
- [Simplified cutover](docs/talos-migration-simplified.md) (used for this migration)
- [Rolling zero-downtime](docs/k3s-to-talos-migration.md)
