#!/bin/bash
# Script to create LXC container for k3s node with AMD GPU support
# Run this on Proxmox host (mirkwood)

set -e

# Configuration
CTID=${1:-114}
HOSTNAME=${2:-metal3}
IP=${3:-192.168.0.14}
MEMORY=${4:-26624}
CORES=${5:-4}
DISK=${6:-50}

echo "=== Creating LXC Container for k3s Node ==="
echo "Container ID: $CTID"
echo "Hostname: $HOSTNAME"
echo "IP Address: $IP/24"
echo "Memory: ${MEMORY}MB"
echo "Cores: $CORES"
echo "Disk: ${DISK}GB"
echo ""

# Check if container already exists
if pct status $CTID &>/dev/null; then
    echo "ERROR: Container $CTID already exists!"
    echo "To destroy and recreate, run: pct destroy $CTID"
    exit 1
fi

# Find GPU device numbers
echo "Detecting AMD GPU devices..."
CARD_MAJOR=$(stat -c '%t' /dev/dri/card0 2>/dev/null | xargs printf '%d')
CARD_MINOR=$(stat -c '%T' /dev/dri/card0 2>/dev/null | xargs printf '%d')
RENDER_MAJOR=$(stat -c '%t' /dev/dri/renderD128 2>/dev/null | xargs printf '%d')
RENDER_MINOR=$(stat -c '%T' /dev/dri/renderD128 2>/dev/null | xargs printf '%d')

echo "GPU Devices:"
echo "  /dev/dri/card0: $CARD_MAJOR:$CARD_MINOR"
echo "  /dev/dri/renderD128: $RENDER_MAJOR:$RENDER_MINOR"
echo ""

# Create container
echo "Creating container..."
pct create $CTID local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
  --hostname $HOSTNAME \
  --memory $MEMORY \
  --cores $CORES \
  --storage local-lvm \
  --rootfs local-lvm:$DISK \
  --net0 name=eth0,bridge=vmbr1,ip=$IP/24,gw=192.168.0.1 \
  --nameserver 192.168.0.1 \
  --features nesting=1,keyctl=1 \
  --unprivileged 0 \
  --onboot 1

echo "Container created successfully!"
echo ""

# Configure for Kubernetes and GPU
echo "Configuring container for k3s and GPU access..."

cat >> /etc/pve/lxc/${CTID}.conf <<EOF

# Kubernetes configuration
lxc.apparmor.profile: unconfined
lxc.cgroup2.devices.allow: a
lxc.cap.drop:
lxc.mount.auto: proc:rw sys:rw cgroup:rw

# AMD GPU passthrough
lxc.cgroup2.devices.allow: c ${CARD_MAJOR}:${CARD_MINOR} rwm
lxc.cgroup2.devices.allow: c ${RENDER_MAJOR}:${RENDER_MINOR} rwm
lxc.mount.entry: /dev/dri/card0 dev/dri/card0 none bind,optional,create=file
lxc.mount.entry: /dev/dri/renderD128 dev/dri/renderD128 none bind,optional,create=file

# AMD KFD for compute
lxc.cgroup2.devices.allow: c 10:232 rwm
lxc.mount.entry: /dev/kfd dev/kfd none bind,optional,create=file
EOF

echo "Configuration updated!"
echo ""

# Start container
echo "Starting container..."
pct start $CTID

# Wait for container to boot
echo "Waiting for container to boot..."
sleep 5

# Setup SSH key
echo "Setting up SSH access..."
if [ -f ~/.ssh/id_ed25519.pub ]; then
    pct exec $CTID -- bash -c "mkdir -p /root/.ssh && chmod 700 /root/.ssh"
    cat ~/.ssh/id_ed25519.pub | pct exec $CTID -- bash -c "cat > /root/.ssh/authorized_keys"
    pct exec $CTID -- bash -c "chmod 600 /root/.ssh/authorized_keys"
fi

# Install prerequisites
echo "Installing k3s prerequisites..."
pct exec $CTID -- bash <<'SCRIPT'
export DEBIAN_FRONTEND=noninteractive

# Update system
apt-get update
apt-get upgrade -y

# Install required packages
apt-get install -y \
  curl \
  wget \
  iptables \
  socat \
  conntrack \
  ipset \
  ca-certificates \
  openssh-server \
  nano \
  htop

# Enable kernel modules
cat > /etc/modules-load.d/k3s.conf <<EOF
overlay
br_netfilter
EOF

modprobe overlay || true
modprobe br_netfilter || true

# Configure sysctl
cat > /etc/sysctl.d/k3s.conf <<EOF
net.bridge.bridge-nf-call-iptables = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward = 1
EOF

sysctl --system

echo "Prerequisites installed!"
SCRIPT

echo ""
echo "=== LXC Container Created Successfully! ==="
echo ""
echo "Container Details:"
echo "  ID: $CTID"
echo "  Hostname: $HOSTNAME"
echo "  IP: $IP"
echo "  SSH: ssh root@$IP"
echo ""
echo "Next Steps:"
echo "1. Add to Ansible inventory: metal/inventories/prod.yml"
echo "2. Run Ansible playbook: cd metal && ansible-playbook -i inventories/prod.yml cluster.yml --limit $HOSTNAME"
echo "3. Verify node: kubectl get nodes"
echo "4. Check GPU: kubectl describe node $HOSTNAME | grep -i gpu"
echo ""
echo "To verify GPU access now:"
echo "  pct exec $CTID -- ls -la /dev/dri/"
echo ""
