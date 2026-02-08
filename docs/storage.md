# Portkey Storage Guide

This document describes the storage classes and S3 object storage available in the Portkey Kubernetes cluster.

## Table of Contents

1. [Storage Overview](#storage-overview)
2. [Storage Classes](#storage-classes)
   - [ceph-block (default)](#ceph-block-default)
   - [ceph-filesystem](#ceph-filesystem)
   - [nfs-csi](#nfs-csi)
   - [ceph-bucket](#ceph-bucket)
   - [ceph-rbd (legacy)](#ceph-rbd-legacy)
3. [S3 Object Storage](#s3-object-storage)
   - [Endpoints](#endpoints)
   - [Creating a Bucket with ObjectBucketClaim](#creating-a-bucket-with-objectbucketclaim)
   - [Using S3 from a Pod](#using-s3-from-a-pod)
   - [Using S3 from Outside the Cluster](#using-s3-from-outside-the-cluster)
4. [Volume Snapshots](#volume-snapshots)
5. [Examples](#examples)

---

## Storage Overview

The cluster provides storage backed by two systems:

| Backend | Nodes | Technology | Use Cases |
|---------|-------|-----------|-----------|
| **Ceph** (external) | shire, rivendell, isengard | NVMe SSDs, 3-node Proxmox Ceph cluster | Block volumes, shared filesystems, S3 object storage |
| **NFS** | shire (192.168.0.41) | 8-disk ZFS array via LXC container | Bulk storage, media files, backups |

```
┌──────────────────────────────────────────────────────────────────┐
│                    Kubernetes Cluster                             │
│                                                                  │
│  ┌──────────┐  ┌───────────────┐  ┌─────────┐  ┌────────────┐  │
│  │ceph-block│  │ceph-filesystem│  │ nfs-csi │  │ceph-bucket │  │
│  │  (RWO)   │  │    (RWX)      │  │  (RWX)  │  │   (S3)     │  │
│  └────┬─────┘  └───────┬───────┘  └────┬────┘  └─────┬──────┘  │
│       │                │               │              │         │
│  ┌────┴────┐     ┌─────┴─────┐    ┌────┴────┐   ┌────┴─────┐  │
│  │ RBD CSI │     │CephFS CSI │    │ NFS CSI │   │ RGW/S3   │  │
│  └────┬────┘     └─────┬─────┘    └────┬────┘   └────┬─────┘  │
└───────┼────────────────┼───────────────┼──────────────┼─────────┘
        │                │               │              │
   ┌────┴────────────────┴───────┐  ┌────┴────┐   ┌────┴─────┐
   │    Proxmox Ceph Cluster     │  │  Shire  │   │  Ceph    │
   │  shire/rivendell/isengard   │  │  NFS    │   │  RGW     │
   │  (NVMe SSDs, 3x replicated)│  │  (ZFS)  │   │          │
   └─────────────────────────────┘  └─────────┘   └──────────┘
```

## Storage Classes

### ceph-block (default)

Block storage backed by Ceph RBD. This is the **default** storage class — PVCs without an explicit `storageClassName` will use this.

| Property | Value |
|----------|-------|
| Provisioner | `rook-ceph.rbd.csi.ceph.com` |
| Access Modes | **ReadWriteOnce (RWO)** |
| Reclaim Policy | Delete |
| Volume Expansion | Yes |
| Snapshot Support | Yes (`ceph-block` VolumeSnapshotClass) |
| Pool | `ceph-blockpool` (3x replicated) |

**Best for:** Databases (MariaDB, PostgreSQL), application data, anything needing fast block I/O with a single writer.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-app-data
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 10Gi
  # storageClassName: ceph-block  # optional — it's the default
```

---

### ceph-filesystem

Shared filesystem backed by CephFS. Supports multiple pods reading and writing simultaneously.

| Property | Value |
|----------|-------|
| Provisioner | `rook-ceph.cephfs.csi.ceph.com` |
| Access Modes | **ReadWriteMany (RWX)** |
| Reclaim Policy | Delete |
| Volume Expansion | Yes |
| Snapshot Support | No |
| Filesystem | `cephfs` (Proxmox-managed, MDS on Proxmox hosts) |
| Data Pool | `cephfs_data` |

**Best for:** Shared uploads directories (e.g., WordPress wp-content/uploads), any workload needing multiple pods to access the same files, HPA-scaled deployments.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: shared-uploads
spec:
  accessModes: ["ReadWriteMany"]
  storageClassName: ceph-filesystem
  resources:
    requests:
      storage: 5Gi
```

> **Note:** This uses the existing Proxmox-managed CephFS filesystem (MDS runs on Proxmox hosts), not a Rook-managed one. This is intentional — the external Ceph cluster's MGR cannot reach MDS pods inside the Kubernetes network.

---

### nfs-csi

NFS storage from the ZFS array on Shire (192.168.0.41). Good for bulk storage where Ceph's replication overhead isn't needed.

| Property | Value |
|----------|-------|
| Provisioner | `nfs.csi.k8s.io` |
| Access Modes | **ReadWriteMany (RWX)** |
| Reclaim Policy | **Retain** (volumes kept after PVC deletion) |
| Volume Expansion | Yes |
| Snapshot Support | Yes (`csi-nfs-snapclass` VolumeSnapshotClass) |
| Server | `192.168.0.41` |
| Share Path | `/nfs/k8s` |
| Mount Options | `vers=4.1`, `nconnect=8`, `hard`, `noatime`, `rw` |

**Best for:** Media libraries (Jellyfin, Navidrome), large file storage, backups, anything where data lives on the ZFS array.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: media-storage
spec:
  accessModes: ["ReadWriteMany"]
  storageClassName: nfs-csi
  resources:
    requests:
      storage: 100Gi
```

> **Note:** Reclaim policy is **Retain** — deleting a PVC will not delete the underlying NFS directory. Clean up manually on the NFS server if needed.

---

### ceph-bucket

S3-compatible object storage provisioner. Creates buckets via `ObjectBucketClaim` resources (not standard PVCs). See [S3 Object Storage](#s3-object-storage) below.

| Property | Value |
|----------|-------|
| Provisioner | `rook-ceph.ceph.rook.io/bucket` |
| Object Store | `ceph-objectstore` |
| Region | `us-east-1` |
| Reclaim Policy | Delete |

---

### ceph-rbd (legacy)

An older RBD storage class pointing to the `rook-k8s` pool. **Use `ceph-block` instead for new workloads.**

| Property | Value |
|----------|-------|
| Pool | `rook-k8s` (legacy pool name) |
| Provisioner | `rook-ceph.rbd.csi.ceph.com` |

---

## S3 Object Storage

The cluster runs a Ceph RADOS Gateway (RGW) providing S3-compatible object storage.

### Endpoints

| Access | Endpoint | TLS |
|--------|----------|-----|
| **External** | `https://s3.themainfreak.com` | Yes (Let's Encrypt) |
| **In-cluster** | `http://rook-ceph-rgw-ceph-objectstore.rook-ceph.svc:80` | No |

### Creating a Bucket with ObjectBucketClaim

The `ceph-bucket` StorageClass provisions S3 buckets dynamically. When you create an `ObjectBucketClaim`, Rook automatically:
1. Creates the bucket in the object store
2. Creates a `ConfigMap` with the bucket name and endpoint
3. Creates a `Secret` with the access key and secret key

```yaml
apiVersion: objectbucket.io/v1alpha1
kind: ObjectBucketClaim
metadata:
  name: my-app-bucket
spec:
  generateBucketName: my-app       # bucket name will be my-app-<random>
  storageClassName: ceph-bucket
```

After applying, check the generated resources:

```bash
# Bucket connection info
kubectl get configmap my-app-bucket -o yaml
# Contains: BUCKET_HOST, BUCKET_NAME, BUCKET_PORT, BUCKET_REGION

# Bucket credentials
kubectl get secret my-app-bucket -o yaml
# Contains: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
```

### Using S3 from a Pod

Reference the auto-generated ConfigMap and Secret as environment variables:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: s3-client
spec:
  containers:
  - name: app
    image: amazon/aws-cli:latest
    command: ["sleep", "infinity"]
    env:
    - name: AWS_ACCESS_KEY_ID
      valueFrom:
        secretKeyRef:
          name: my-app-bucket
          key: AWS_ACCESS_KEY_ID
    - name: AWS_SECRET_ACCESS_KEY
      valueFrom:
        secretKeyRef:
          name: my-app-bucket
          key: AWS_SECRET_ACCESS_KEY
    - name: BUCKET_NAME
      valueFrom:
        configMapKeyRef:
          name: my-app-bucket
          key: BUCKET_NAME
    - name: S3_ENDPOINT
      value: "http://rook-ceph-rgw-ceph-objectstore.rook-ceph.svc:80"
```

Then inside the pod:

```bash
# List bucket contents
aws s3 ls s3://$BUCKET_NAME --endpoint-url $S3_ENDPOINT

# Upload a file
aws s3 cp /tmp/myfile.txt s3://$BUCKET_NAME/ --endpoint-url $S3_ENDPOINT

# Download a file
aws s3 cp s3://$BUCKET_NAME/myfile.txt /tmp/ --endpoint-url $S3_ENDPOINT
```

### Using S3 from Outside the Cluster

The RGW is exposed via ingress at `https://s3.themainfreak.com`. You need valid credentials — either from an ObjectBucketClaim or created manually via the RGW admin API.

```bash
# Configure AWS CLI
aws configure
# AWS Access Key ID: <from secret>
# AWS Secret Access Key: <from secret>
# Default region: us-east-1

# Use the external endpoint
aws s3 ls s3://my-bucket --endpoint-url https://s3.themainfreak.com

# Upload
aws s3 cp backup.tar.gz s3://my-bucket/ --endpoint-url https://s3.themainfreak.com
```

Or with environment variables:

```bash
export AWS_ACCESS_KEY_ID="<access-key>"
export AWS_SECRET_ACCESS_KEY="<secret-key>"
export AWS_DEFAULT_REGION="us-east-1"

aws s3 ls --endpoint-url https://s3.themainfreak.com
```

---

## Volume Snapshots

Two VolumeSnapshotClasses are available:

| Name | Driver | Use With |
|------|--------|----------|
| `ceph-block` | `rook-ceph.rbd.csi.ceph.com` | `ceph-block` PVCs |
| `csi-nfs-snapclass` | `nfs.csi.k8s.io` | `nfs-csi` PVCs |

Create a snapshot:

```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: my-app-snapshot
spec:
  volumeSnapshotClassName: ceph-block
  source:
    persistentVolumeClaimName: my-app-data
```

Restore from a snapshot:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-app-restored
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: ceph-block
  resources:
    requests:
      storage: 10Gi
  dataSource:
    name: my-app-snapshot
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
```

---

## Examples

### Database with block storage and snapshots

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-data
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 20Gi
  # Uses ceph-block (default)
```

### Scaled web app with shared CephFS uploads

```yaml
# Shared upload volume
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-uploads
spec:
  accessModes: ["ReadWriteMany"]
  storageClassName: ceph-filesystem
  resources:
    requests:
      storage: 10Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  replicas: 3    # all pods share the same uploads volume
  template:
    spec:
      containers:
      - name: app
        image: my-web-app:latest
        volumeMounts:
        - name: uploads
          mountPath: /app/uploads
      volumes:
      - name: uploads
        persistentVolumeClaim:
          claimName: app-uploads
```

### App with S3 backup bucket

```yaml
apiVersion: objectbucket.io/v1alpha1
kind: ObjectBucketClaim
metadata:
  name: app-backups
spec:
  generateBucketName: app-backups
  storageClassName: ceph-bucket
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: backup-to-s3
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: amazon/aws-cli:latest
            command:
            - sh
            - -c
            - |
              aws s3 sync /data s3://$BUCKET_NAME/daily/ \
                --endpoint-url http://rook-ceph-rgw-ceph-objectstore.rook-ceph.svc:80
            env:
            - name: AWS_ACCESS_KEY_ID
              valueFrom:
                secretKeyRef:
                  name: app-backups
                  key: AWS_ACCESS_KEY_ID
            - name: AWS_SECRET_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: app-backups
                  key: AWS_SECRET_ACCESS_KEY
            - name: BUCKET_NAME
              valueFrom:
                configMapKeyRef:
                  name: app-backups
                  key: BUCKET_NAME
          restartPolicy: OnFailure
```

## Quick Reference

| Need | Storage Class | Access Mode |
|------|--------------|-------------|
| Database / single-pod app | `ceph-block` | RWO |
| Shared files across pods | `ceph-filesystem` | RWX |
| Media / bulk files on ZFS | `nfs-csi` | RWX |
| S3 bucket | `ceph-bucket` | ObjectBucketClaim |
| Legacy block (avoid) | `ceph-rbd` | RWO |
