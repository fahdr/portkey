# Adding LXC Container as Kubernetes Node with GPU Access

## Overview
This guide shows how to create an LXC container on Proxmox (mirkwood) that can join the k3s cluster and access the AMD Ryzen 5 4500U integrated GPU.

## Prerequisites
- Proxmox host: mirkwood (192.168.0.8)
- AMD Ryzen 5 4500U with Radeon Vega 6 Graphics
- Existing k3s cluster

## Step 1: Create LXC Container on Proxmox

### Option A: Via Proxmox Web UI
1. Navigate to Proxmox web interface
2. Create Container → Choose template (Ubuntu 22.04 or Rocky Linux)
3. Container ID: 114 (or your choice)
4. Hostname: metal3
5. Resources:
   - Memory: 26GB (match metal1/metal2)
   - CPU: 4 cores
   - Disk: 50GB
6. Network:
   - Bridge: vmbr1
   - IPv4: 192.168.0.14/24
   - Gateway: 192.168.0.1
   - DNS: 192.168.0.1

### Option B: Via CLI on mirkwood
```bash
# SSH to mirkwood
ssh root@192.168.0.8

# Create LXC container
pct create 114 local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
  --hostname metal3 \
  --memory 26624 \
  --cores 4 \
  --storage local-lvm \
  --rootfs local-lvm:50 \
  --net0 name=eth0,bridge=vmbr1,ip=192.168.0.14/24,gw=192.168.0.1 \
  --nameserver 192.168.0.1 \
  --features nesting=1,keyctl=1 \
  --unprivileged 0 \
  --start 1
```

## Step 2: Configure LXC for Kubernetes

### Edit LXC Configuration
On mirkwood Proxmox host:

```bash
# Stop container if running
pct stop 114

# Edit container config
nano /etc/pve/lxc/114.conf
```

Add these lines to enable Kubernetes and GPU support:

```conf
# Kubernetes requirements
lxc.apparmor.profile: unconfined
lxc.cgroup2.devices.allow: a
lxc.cap.drop:
lxc.mount.auto: proc:rw sys:rw cgroup:rw

# AMD GPU passthrough (Radeon Vega)
# First, find the GPU device numbers on host:
# ls -l /dev/dri/
# Typically: card0 (226:0) and renderD128 (226:128)

lxc.cgroup2.devices.allow: c 226:0 rwm
lxc.cgroup2.devices.allow: c 226:128 rwm
lxc.mount.entry: /dev/dri/card0 dev/dri/card0 none bind,optional,create=file
lxc.mount.entry: /dev/dri/renderD128 dev/dri/renderD128 none bind,optional,create=file

# Kernel modules for AMD GPU
lxc.mount.entry: /dev/kfd dev/kfd none bind,optional,create=file
lxc.cgroup2.devices.allow: c 10:232 rwm
```

### Start Container
```bash
pct start 114
```

## Step 3: Verify GPU Access in Container

```bash
# Enter container
pct enter 114

# Check GPU devices
ls -la /dev/dri/
# Should show: card0, renderD128

# Install utilities to test
apt update
apt install -y pciutils mesa-utils

# Verify GPU is visible
lspci | grep -i vga
# Should show: AMD Renoir GPU

# Test OpenGL (if Mesa drivers installed)
glxinfo | grep -i "opengl renderer"
```

## Step 4: Prepare Container for k3s

Inside the LXC container:

```bash
# Update system
apt update && apt upgrade -y

# Install required packages
apt install -y \
  curl \
  iptables \
  socat \
  conntrack \
  ipset \
  ca-certificates

# Load kernel modules (if not auto-loaded)
modprobe overlay
modprobe br_netfilter

# Ensure modules load on boot
cat > /etc/modules-load.d/k3s.conf <<EOF
overlay
br_netfilter
EOF

# Configure sysctl
cat > /etc/sysctl.d/k3s.conf <<EOF
net.bridge.bridge-nf-call-iptables = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward = 1
EOF

sysctl --system
```

## Step 5: Add to Ansible Inventory

Update `/workspaces/portkey/metal/inventories/prod.yml`:

```yaml
all:
  vars:
    control_plane_endpoint: 192.168.0.100
    load_balancer_ip_pool:
      - 192.168.0.224/27
metal:
  children:
    masters:
      hosts:
        # mirkwood
        metal0: {ansible_host: 192.168.0.11, mac: 'bc:24:11:ad:b2:f3', disk: sda, network_interface: ens18}
        # rohan
        metal1: {ansible_host: 192.168.0.12, mac: 'bc:24:11:1f:7d:4c', disk: sda, network_interface: ens18}
        # gondor
        metal2: {ansible_host: 192.168.0.13, mac: 'bc:24:11:fb:35:66', disk: sda, network_interface: ens18}
        # mirkwood LXC
        metal3: {ansible_host: 192.168.0.14, mac: 'auto', disk: sda, network_interface: eth0, is_lxc: true}
    workers:
      hosts:
```

## Step 6: Join to k3s Cluster

### Option A: Use Ansible (Recommended)
From your dev environment:

```bash
cd /workspaces/portkey/metal
ansible-playbook -i inventories/prod.yml cluster.yml --limit metal3
```

### Option B: Manual Join
Inside metal3 container:

```bash
# Get token from existing node
TOKEN=$(ssh root@192.168.0.11 cat /etc/rancher/node/password)

# Join cluster
curl -sfL https://get.k3s.io | K3S_URL=https://192.168.0.100:6443 \
  K3S_TOKEN=$TOKEN \
  INSTALL_K3S_VERSION=v1.33.0+k3s1 \
  INSTALL_K3S_EXEC="--node-name metal3" \
  sh -
```

## Step 7: Install AMD GPU Device Plugin

After node joins, install AMD GPU device plugin:

```yaml
# Create: platform/amd-gpu/Chart.yaml
apiVersion: v2
name: amd-gpu
description: AMD GPU Device Plugin
type: application
version: 0.1.0

# Create: platform/amd-gpu/values.yaml
amd-device-plugin:
  enabled: true
  nodeSelector:
    kubernetes.io/hostname: metal3

# Add to ArgoCD
```

Or use DaemonSet directly:

```bash
kubectl apply -f https://raw.githubusercontent.com/RadeonOpenCompute/k8s-device-plugin/master/k8s-ds-amdgpu-dp.yaml

# Label node for AMD GPU
kubectl label node metal3 gpu.amd.com/gpu=radeon-vega
```

## Step 8: Verify Node and GPU

```bash
# Check node status
kubectl get nodes
# Should show metal3

# Check GPU resources
kubectl describe node metal3 | grep -A 5 "Allocatable:"
# Should show: amd.com/gpu or similar

# Test GPU workload
kubectl run gpu-test --image=rocm/pytorch:latest \
  --limits="amd.com/gpu=1" \
  --rm -it -- bash -c "rocminfo | grep 'Name:'"
```

## Troubleshooting

### Container won't start
- Check `/etc/pve/lxc/114.conf` for syntax errors
- Ensure `features: nesting=1` is set
- Use privileged container (`unprivileged: 0`)

### GPU not visible in container
- Verify on host: `ls -l /dev/dri/`
- Check device permissions in LXC config
- Ensure `lxc.cgroup2.devices.allow` entries are correct

### k3s fails to start
- Check `/var/log/syslog` in container
- Verify kernel modules: `lsmod | grep -E "overlay|br_netfilter"`
- Ensure AppArmor is disabled: `aa-status`

### GPU device plugin doesn't detect GPU
- Install AMD ROCm drivers in container
- Verify `/dev/dri/renderD128` exists
- Check plugin logs: `kubectl logs -n kube-system -l name=amdgpu-device-plugin-daemonset`

## Performance Notes

- LXC shares kernel with Proxmox host
- GPU performance should be near-native (no virtualization overhead)
- Memory overhead is minimal compared to VMs
- Network performance is excellent (no VM networking stack)

## Security Considerations

- Privileged LXC containers have fewer isolation guarantees than VMs
- Shared kernel means kernel exploits affect host
- For production, consider VM isolation vs. LXC convenience
- AMD GPU sharing is safe (kernel-level arbitration)

## Comparison: LXC vs VM for Kubernetes

| Feature | LXC | VM |
|---------|-----|-----|
| GPU Access | Native (device passthrough) | Complex (PCIe passthrough) |
| Memory Overhead | ~50MB | ~500MB+ |
| Boot Time | <5s | ~30s |
| Kernel | Shared with host | Independent |
| Isolation | Process-level | Hardware-level |
| Live Migration | Limited | Full support |
| k3s Support | Excellent | Excellent |
