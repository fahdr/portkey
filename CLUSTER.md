# Portkey Cluster Architecture

## Overview

This is a 3-node bare-metal Kubernetes cluster running on Proxmox with external Ceph storage.

## Nodes

| Node | Role | Resources | Special Hardware | Proxmox Host | Type |
|------|------|-----------|------------------|--------------|------|
| metal0 | Worker | 4 CPU, 42GB RAM | - | mirkwood (AMD Ryzen 5 4500U) | VM |
| metal1 | Worker | 4 CPU, 26GB RAM | Intel GPU (i915) | rohan (Intel N100) | VM |
| metal2 | Worker | 4 CPU, 26GB RAM | Intel GPU (i915) | gondor (Intel N100) | VM |

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
