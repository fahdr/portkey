# Talos Linux Cluster Automation

Ansible playbooks for deploying and managing a Talos Linux Kubernetes cluster on Proxmox.

## Cluster Overview

- **OS**: Talos Linux v1.12.3
- **Kubernetes**: v1.35.0
- **Nodes**: 3 control plane nodes (metal0, metal1, metal2)
- **Networking**: Cilium 1.17.4 CNI with kube-proxy replacement
- **Storage**: Rook Ceph (external cluster), NFS CSI

## Prerequisites

### Required Tools

```bash
# Ansible 2.15+
ansible-galaxy collection install community.general kubernetes.core

# talosctl CLI
curl -sL https://talos.dev/install | sh

# Python dependencies
pip install kubernetes pyyaml
```

### Proxmox API Credentials

Create a `.env` file in this directory:

```bash
PROXMOX_HOST=192.168.0.2
PROXMOX_USER=root@pam
PROXMOX_TOKEN_ID=ansible-claude
PROXMOX_TOKEN_SECRET=your-token-secret
```

## Complete Deployment Workflow

### Step 1: Upload Talos ISO

```bash
ansible-playbook playbooks/talos-upload-iso.yml
```

### Step 2: Boot VMs into Talos

```bash
# Boot all control plane nodes
ansible-playbook -i inventories/talos.yml playbooks/talos-create-new-disks.yml

# This will:
# - Stop existing VMs
# - Detach old disks (preserved as backups)
# - Create new 50GB disks for Talos
# - Attach Talos ISO and boot VMs
```

### Step 3: Apply Talos Configurations

```bash
# Apply machine configs to all nodes
ansible-playbook -i inventories/talos.yml playbooks/talos-apply-configs.yml
```

### Step 4: Bootstrap the Cluster

```bash
# Bootstrap etcd and Kubernetes
talosctl --talosconfig talos-configs/talosconfig bootstrap --nodes 192.168.0.11
```

### Step 5: Post-Bootstrap Setup

```bash
# Deploy Cilium CNI, configure networking, get kubeconfig
ansible-playbook playbooks/talos-post-bootstrap.yml
```

### Step 6: Deploy Storage

```bash
# Deploy Rook Ceph and NFS CSI
ansible-playbook playbooks/talos-deploy-storage.yml
```

### Step 7: Deploy Ingress Controller

```bash
# Deploy NGINX Ingress Controller
ansible-playbook playbooks/talos-deploy-ingress.yml
```

### Step 8: Deploy ArgoCD

```bash
# Bootstrap ArgoCD
cd ../bootstrap/argocd
bash apply.sh
```

## Common Operations

### Access the Cluster

```bash
# Set environment variables
export TALOSCONFIG=$(pwd)/talos-configs/talosconfig
export KUBECONFIG=$(pwd)/kubeconfig

# Check cluster health
talosctl health

# View nodes
kubectl get nodes -o wide

# Access Talos dashboard
talosctl dashboard
```

### Upgrade Talos

```bash
talosctl upgrade \
  --nodes 192.168.0.11,192.168.0.12,192.168.0.13 \
  --image ghcr.io/siderolabs/installer:v1.13.0 \
  --preserve
```

### Upgrade Kubernetes

```bash
talosctl upgrade-k8s \
  --nodes 192.168.0.11,192.168.0.12,192.168.0.13 \
  --to 1.36.0
```

### View Logs

```bash
# Kubelet logs
talosctl logs kubelet --nodes 192.168.0.11

# etcd logs
talosctl logs etcd --nodes 192.168.0.11

# Kernel logs
talosctl dmesg --nodes 192.168.0.11
```

### Reboot a Node

```bash
# Graceful reboot
talosctl reboot --nodes 192.168.0.12
```

## Troubleshooting

### Node not accessible

```bash
# Check if Talos API is responding
talosctl version --nodes 192.168.0.11

# Check VM console via Proxmox UI to see boot status
```

### Cilium not starting

```bash
# Check Cilium pods
kubectl get pods -n kube-system -l app.kubernetes.io/name=cilium

# View Cilium logs
kubectl logs -n kube-system -l app.kubernetes.io/name=cilium --tail=50
```

### Storage not working

```bash
# Check Rook status
kubectl get cephcluster -n rook-ceph
kubectl get pods -n rook-ceph

# Check storage classes
kubectl get storageclasses

# Test PVC creation
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: test-pvc
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 1Gi
  storageClassName: ceph-block
EOF
```

## Playbook Reference

| Playbook | Purpose |
|----------|---------|
| `talos-upload-iso.yml` | Upload Talos ISO to all Proxmox nodes |
| `talos-create-new-disks.yml` | Create VMs with new disks, preserve old ones |
| `talos-apply-configs.yml` | Apply machine configs to nodes |
| `talos-post-bootstrap.yml` | Get kubeconfig, deploy Cilium, configure networking (orchestrator) |
| `talos-install-cilium.yml` | Install Cilium CNI using helm CLI (Talos-compatible) |
| `talos-deploy-cilium.yml` | Deploy Cilium CNI using Ansible helm module (may have issues) |
| `talos-configure-networking.yml` | Configure L2 announcements and IP pools |
| `talos-deploy-storage.yml` | Deploy Rook Ceph and NFS CSI |
| `talos-deploy-ingress.yml` | Deploy NGINX Ingress Controller |

## Architecture

### Network Configuration

- **Control Plane VIP**: 192.168.0.100 (Talos built-in VIP)
- **Pod CIDR**: 10.0.1.0/8
- **Service CIDR**: 10.43.0.0/16
- **LoadBalancer Pool**: 192.168.0.224/27 (Cilium L2 announcements)

### Storage

- **Ceph RBD** (`ceph-block`): Default storage class for RWO volumes
- **CephFS** (`ceph-filesystem`): Shared filesystem storage (RWX)
- **NFS** (`nfs-csi`): NFS storage from Shire (192.168.0.41)

### Nodes

| Node | IP | VM ID | Proxmox Host | Role |
|------|-----|-------|--------------|------|
| metal0 | 192.168.0.11 | 106 | mirkwood | Control Plane |
| metal1 | 192.168.0.12 | 107 | rohan | Control Plane |
| metal2 | 192.168.0.13 | 104 | gondor | Control Plane |

## Migration from K3s

The old K3s disks are preserved as `unused0` on each VM. To restore if needed:

1. Stop the Talos VM
2. In Proxmox, detach the Talos disk (scsi0)
3. Reattach the old disk (unused0) as scsi0
4. Boot the VM

## Additional Resources

- [Talos Documentation](https://www.talos.dev/)
- [Talos Linux on Proxmox](https://www.talos.dev/latest/talos-guides/install/virtualized-platforms/proxmox/)
- [Cilium Documentation](https://docs.cilium.io/)

---

**Last Updated**: 2026-02-08
**Status**: ✅ Talos cluster deployed and running
