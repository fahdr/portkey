# Talos Linux Cluster Automation

Ansible playbooks for deploying and managing a Talos Linux Kubernetes cluster on Proxmox.

## Cluster Overview

- **OS**: Talos Linux v1.12.3 (Image Factory with i915-ucode extension)
- **Kubernetes**: v1.35.0
- **Nodes**: 3 control plane nodes (metal0, metal1, metal2)
- **Networking**: Cilium 1.17.4 CNI with kube-proxy replacement
- **Storage**: Rook Ceph (external cluster), NFS CSI
- **GPU**: Intel i915 via Talos system extension + intel-device-plugins-operator

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

Rolling upgrade using Ansible (recommended — one node at a time):

```bash
ansible-playbook -i inventories/talos.yml playbooks/talos-upgrade.yml
```

Or manually per-node (use the Image Factory image to preserve extensions):

```bash
talosctl --nodes 192.168.0.11 upgrade \
  --image factory.talos.dev/installer/<schematic-id>:<talos-version>
```

> **Important**: Always use the Image Factory URL (not `ghcr.io/siderolabs/installer`) so system extensions like i915-ucode are included. The schematic ID is in `roles/talos_config/defaults/main.yml`.

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
| `talos-upgrade.yml` | Rolling upgrade of all nodes (one at a time) |

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

## System Extensions (Image Factory)

Talos uses an immutable root filesystem — kernel modules like i915 (Intel GPU) are not included by default. To add drivers, we use [Talos Image Factory](https://factory.talos.dev) to build custom installer images with system extensions baked in.

### Current Extensions

| Extension | Purpose |
|-----------|---------|
| `i915-ucode` | Intel GPU firmware + i915 kernel module |

### How It Works

1. A **schematic** defines which extensions to include
2. The schematic ID is submitted to `factory.talos.dev/schematics` API
3. The factory returns a schematic hash used in the installer image URL
4. Format: `factory.talos.dev/installer/<schematic-id>:<talos-version>`

### Adding a New Extension

1. Find the extension name from [Talos Extensions](https://github.com/siderolabs/extensions)
2. Generate a new schematic:
   ```bash
   curl -X POST https://factory.talos.dev/schematics \
     -H "Content-Type: application/json" \
     -d '{"customization":{"systemExtensions":{"officialExtensions":[
       "siderolabs/i915-ucode",
       "siderolabs/NEW-EXTENSION"
     ]}}}'
   ```
3. Update `talos_image_factory_schematic` in `roles/talos_config/defaults/main.yml`
4. Add to `talos_extensions` list (for documentation)
5. Run the upgrade playbook: `ansible-playbook -i inventories/talos.yml playbooks/talos-upgrade.yml`

### Verifying Extensions

```bash
# Check installed extensions on a node
talosctl -n 192.168.0.11 get extensions

# Check if a kernel module is loaded
talosctl -n 192.168.0.11 read /proc/modules | grep i915

# Check for GPU device files
talosctl -n 192.168.0.11 ls /dev/dri/
```

## PodSecurity (Talos-Specific)

Talos enforces Pod Security Standards at the **baseline** level on all namespaces by default. This is stricter than K3s which had no enforcement.

Apps that need `hostNetwork`, `hostPID`, `hostPath`, `privileged` containers, or capabilities like `SYS_ADMIN` or `NET_ADMIN` must have their namespace labeled as `privileged`.

### Apps Requiring Privileged PodSecurity

Each of these has a `templates/namespace.yaml` that sets the label:

| App | Reason |
|-----|--------|
| monitoring-system | node-exporter: hostNetwork, hostPID, hostPath |
| nfs-csi | CSI driver: SYS_ADMIN, hostPath, privileged |
| rook-ceph | Storage operator: privileged containers |
| kured | Reboot daemon: hostPID, privileged, hostPath |
| akri | Device discovery: hostPath |
| homeassistant | Bluetooth: hostPath for /run/dbus |
| zigbee2mqtt | USB device: privileged container |
| zerotier | Networking: NET_ADMIN, hostPath |

### Adding PodSecurity to a New App

For Helm charts, create `templates/namespace.yaml`:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: {{ .Release.Namespace }}
  labels:
    pod-security.kubernetes.io/enforce: privileged
    pod-security.kubernetes.io/audit: privileged
    pod-security.kubernetes.io/warn: privileged
```

For Kustomize apps, create `namespace.yaml` and add it to `kustomization.yaml` resources.

## GPU Passthrough (Intel i915)

Intel GPU passthrough is enabled on nodes where Proxmox passes through the iGPU to the VM.

### Requirements

1. **Proxmox**: GPU device passed through to VM (PCI passthrough)
2. **Talos**: `i915-ucode` system extension installed (via Image Factory)
3. **Talos config**: `machine.kernel.modules: [{name: i915}]`
4. **Kubernetes**: `intel-device-plugins-operator` + Node Feature Discovery (NFD)

### How It Works

1. i915 extension provides the kernel module
2. `machine.kernel.modules` config tells Talos to load it at boot
3. NFD detects the GPU and labels the node: `intel.feature.node.kubernetes.io/gpu=true`
4. GpuDevicePlugin DaemonSet schedules on labeled nodes
5. Pods request `gpu.intel.com/i915` resource for GPU access

### Verify GPU Is Working

```bash
# Check which nodes have GPU
kubectl get nodes -l intel.feature.node.kubernetes.io/gpu=true

# Check GPU plugin pods
kubectl get pods -n intel-gpu

# Check device files on a node
talosctl -n 192.168.0.11 ls /dev/dri/
# Should show: card0, renderD128
```

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

**Last Updated**: 2026-02-09
**Status**: ✅ Talos cluster deployed and running
