# Ceph Pools Reference

This document describes all Ceph pools in the Portkey cluster, how they map to Kubernetes storage, and how they're managed.

## Cluster Overview

| Property | Value |
|----------|-------|
| Cluster ID | `3d01e673-493f-4aae-9a00-695ae091a973` |
| Nodes | shire (192.168.0.2), isengard (192.168.0.102), rivendell (192.168.0.202) |
| OSDs | 20 (NVMe SSDs, all up) |
| Total Capacity | 1.2 TiB raw (SSD class) |
| Replication | 3x replicated (default), erasure coding for S3 bulk data |
| Managed By | Proxmox Ceph (external to Kubernetes) |
| K8s Integration | Rook v1.17 with external cluster mode |

```
Proxmox Ceph Cluster (3 nodes, 20 OSDs, 1.2 TiB)
├── MON: shire, isengard, rivendell
├── MGR: shire (active), isengard (standby)
├── MDS: 1 active + 1 standby (Proxmox-managed, for cephfs)
├── OSD: 20 NVMe SSDs across 3 nodes
└── RGW: 1 daemon (runs in K8s via Rook)
```

---

## Pool Inventory

### Summary

| ID | Pool | Type | Replication | Stored | PGs | Application | Used By |
|----|------|------|-------------|--------|-----|-------------|---------|
| 1 | `.mgr` | replicated | 3x | 40 MiB | 1 | mgr | Ceph internal |
| 4 | `k3s` | replicated | 3x | 117 GiB | 128 | rbd | Proxmox VMs/CTs |
| 5 | `cephfs_data` | replicated | 3x | 0 B | 32 | cephfs | K8s `ceph-filesystem` SC |
| 6 | `cephfs_metadata` | replicated | 3x | 166 MiB | 32 | cephfs | CephFS metadata |
| 26 | `ceph-blockpool` | replicated | 3x | 34 GiB | 32 | rbd | K8s `ceph-block` SC (default) |
| 30 | `.rgw.root` | replicated | 3x | 8 KiB | 8 | rgw | RGW realm/zone config |
| 38 | `ceph-objectstore.rgw.otp` | replicated | 3x | 0 B | 8 | rgw | RGW OTP tokens |
| 52 | `ceph-objectstore.rgw.log` | replicated | 3x | 200 KiB | 8 | rgw | RGW operation logs |
| 53 | `ceph-objectstore.rgw.control` | replicated | 3x | 0 B | 8 | rgw | RGW watch/notify |
| 54 | `ceph-objectstore.rgw.meta` | replicated | 3x | 1.5 KiB | 8 | rgw | RGW user/bucket metadata |
| 55 | `ceph-objectstore.rgw.buckets.index` | replicated | 3x | 0 B | 8 | rgw | S3 bucket indexes |
| 56 | `ceph-objectstore.rgw.buckets.non-ec` | replicated | 3x | 0 B | 8 | rgw | S3 non-EC bucket data |
| 57 | `ceph-objectstore.rgw.buckets.data` | **erasure** (2+1) | 3x effective | 0 B | 32 | rgw | S3 bucket data (bulk) |

**Total: 13 pools, 313 PGs**

---

## Pool Details

### `.mgr` (ID 1) — Ceph Manager

Internal pool used by the Ceph Manager daemon for storing cluster metadata, module data, and dashboard state.

- **Managed by:** Ceph (automatic)
- **Do not modify or delete**

---

### `k3s` (ID 4) — Proxmox VM/Container Storage

RBD pool used by Proxmox for virtual machine disks and LXC container root filesystems. This is the primary Proxmox storage pool.

- **Managed by:** Proxmox
- **Stored:** ~117 GiB (largest pool)
- **Objects:** ~31,000 RBD images
- **PGs:** 128 (highest PG count, appropriate for its size)
- **Not used by Kubernetes** — this is exclusively Proxmox storage
- **Do not modify from Kubernetes side**

---

### `cephfs_data` (ID 5) — CephFS Data Pool

Data pool for the Proxmox-managed `cephfs` filesystem. Stores the actual file contents of CephFS volumes.

- **Managed by:** Proxmox (MDS runs on Proxmox hosts)
- **Filesystem:** `cephfs`
- **K8s StorageClass:** `ceph-filesystem` (RWX)
- **K8s provisioner:** `rook-ceph.cephfs.csi.ceph.com`
- **Configuration:** [system/rook-ceph/templates/cephfs-storageclass.yaml](../system/rook-ceph/templates/cephfs-storageclass.yaml)

> **Why Proxmox-managed?** With an external Ceph cluster, Rook-managed MDS pods run in the Kubernetes pod network (10.0.x.x) which is unreachable from the Proxmox MGR. The MGR `volumes` module must reach MDS for subvolume operations, so we use the existing Proxmox MDS instead.

---

### `cephfs_metadata` (ID 6) — CephFS Metadata Pool

Metadata pool for the `cephfs` filesystem. Stores directory structure, file attributes, and MDS journal.

- **Managed by:** Proxmox
- **Has `recovery_priority: 5`** — prioritized during recovery (metadata loss is more impactful than data loss)
- **Has `pg_autoscale_bias: 4`** — PG autoscaler gives it more PGs relative to data stored
- **Stored:** 166 MiB (small but critical)

---

### `ceph-blockpool` (ID 26) — Kubernetes Block Storage

RBD pool used by the default Kubernetes StorageClass. All application PVCs that don't specify a StorageClass land here.

- **K8s StorageClass:** `ceph-block` (default, RWO)
- **K8s provisioner:** `rook-ceph.rbd.csi.ceph.com`
- **Stored:** ~34 GiB across ~9,700 RBD images
- **CRUSH rule:** `ceph-blockpool` (host-level failure domain)
- **Snapshot support:** Yes (`ceph-block` VolumeSnapshotClass)
- **Configuration:** [system/rook-ceph/values.yaml](../system/rook-ceph/values.yaml) under `cephBlockPools`

Current PVs using this pool include: MariaDB, Jellyfin metadata, Paperless, Vaultwarden, HomeAssistant, Grocy, Navidrome, Ollama, Nextcloud, Kanidm, Zigbee2mqtt, ESPHome, ActualBudget, BabyBuddy, Zot registry, and various VolSync caches.

---

### `.rgw.root` (ID 30) — RGW Realm Configuration

Stores RADOS Gateway realm, zonegroup, and zone configuration objects. Required for RGW to function.

- **Managed by:** Rook (via CephObjectStore CR)
- **Contains:** Zone `ceph-objectstore`, zonegroup `ceph-objectstore`, realm `ceph-objectstore`
- **Do not modify manually**

---

### `ceph-objectstore.rgw.*` (IDs 38, 52-57) — S3 Object Storage

Seven pools that together form the S3-compatible object storage backend. All managed by the Rook `CephObjectStore` CR named `ceph-objectstore`.

| Pool | Purpose |
|------|---------|
| `rgw.otp` | One-time password/token storage for MFA |
| `rgw.log` | Operation logs, data log for sync |
| `rgw.control` | Watch/notify control channel (8 notify shards) |
| `rgw.meta` | User accounts, bucket metadata, ACLs |
| `rgw.buckets.index` | Bucket listing indexes (replicated for fast lookups) |
| `rgw.buckets.non-ec` | Small objects that can't use erasure coding |
| **`rgw.buckets.data`** | **Bulk object data** — erasure coded (2 data + 1 coding chunks) |

- **K8s StorageClass:** `ceph-bucket` (ObjectBucketClaim provisioner)
- **External endpoint:** `https://s3.themainfreak.com`
- **Internal endpoint:** `http://rook-ceph-rgw-ceph-objectstore.rook-ceph.svc:80`
- **RGW daemon:** Runs as `rook-ceph-rgw-ceph-objectstore-a` pod in `rook-ceph` namespace
- **Configuration:** [system/rook-ceph/values.yaml](../system/rook-ceph/values.yaml) under `cephObjectStores`

The `buckets.data` pool uses **erasure coding** (2+1 profile) instead of 3x replication, providing ~50% more usable capacity for bulk object data while maintaining single-failure tolerance.

---

## Pool-to-StorageClass Mapping

```
Ceph Pool                          K8s StorageClass      Access    Provisioner
─────────────────────────────────  ───────────────────   ────────  ──────────────────────────
k3s                                (none - Proxmox)      -         -
ceph-blockpool                     ceph-block (default)  RWO       rook-ceph.rbd.csi.ceph.com
cephfs_data / cephfs_metadata      ceph-filesystem       RWX       rook-ceph.cephfs.csi.ceph.com
ceph-objectstore.rgw.*             ceph-bucket           S3 API    rook-ceph.ceph.rook.io/bucket
(NFS - not Ceph)                   nfs-csi               RWX       nfs.csi.k8s.io
```

---

## Replication & Failure Domains

All replicated pools use **size 3, min_size 2**, meaning:
- Data is written to 3 OSDs across different hosts
- Reads/writes continue if 1 OSD (or 1 entire host) is down
- Cluster enters degraded state but remains operational with 2/3 copies

The `ceph-blockpool` uses a host-level CRUSH rule (`ceph-blockpool`), ensuring replicas land on different Proxmox nodes. Other pools use the default `replicated_rule`.

The erasure-coded `rgw.buckets.data` pool uses a 2+1 profile: 2 data chunks + 1 coding chunk, tolerating 1 OSD failure.

---

## Maintenance Notes

### Checking pool status
```bash
# From the Rook operator pod:
CEPH="ceph --conf /var/lib/rook/rook-ceph/rook-ceph.config --keyring /var/lib/rook/rook-ceph/client.admin.keyring"
kubectl -n rook-ceph exec deploy/rook-ceph-operator -- bash -c "$CEPH df detail"
kubectl -n rook-ceph exec deploy/rook-ceph-operator -- bash -c "$CEPH osd pool ls detail"
```

### Pool deletion safety
Pool deletion is disabled by default (`mon_allow_pool_delete = false`). To delete a pool:
```bash
# Temporarily enable, delete, re-disable
$CEPH config set mon mon_allow_pool_delete true
$CEPH osd pool delete <pool> <pool> --yes-i-really-really-mean-it
$CEPH config set mon mon_allow_pool_delete false
```

### PG autoscaling
All pools use `autoscale_mode on`. The PG autoscaler adjusts PG counts based on pool usage. Metadata pools have `pg_autoscale_bias: 4` to ensure they get adequate PGs despite storing less data.

### Cleanup history
The following orphaned pools were removed on 2026-02-08:
- `rook` (empty legacy pool)
- `rook-k8s` (legacy pool from old `ceph-rbd` StorageClass)
- `ceph-filesystem-metadata`, `ceph-filesystem-cephfs_data` (from failed Rook-managed CephFilesystem)
- `default.rgw.log`, `default.rgw.control`, `default.rgw.meta` (stale default RGW zone)
- CephFS filesystem `ceph-filesystem` (Rook-managed, couldn't work with external cluster)
- StorageClass `ceph-rbd` (legacy, pointed to `rook-k8s` pool)
