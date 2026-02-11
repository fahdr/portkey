# Talos Linux Cluster & Bazzite VM Automation

Ansible playbooks for deploying and managing a Talos Linux Kubernetes cluster and Bazzite gaming VMs on Proxmox.

## Cluster Overview

- **OS**: Talos Linux v1.12.3 (Image Factory with i915-ucode extension)
- **Kubernetes**: v1.35.0
- **Nodes**: 3 control plane + 3 worker nodes
- **Networking**: Cilium 1.17.4 CNI with kube-proxy replacement
- **Storage**: Rook Ceph (external cluster), NFS CSI
- **GPU**: Intel i915 via Talos system extension + intel-device-plugins-operator

### Proxmox Hosts

| Host | IP | Role | Notes |
|------|-----|------|-------|
| shire | 192.168.0.2 | Cluster seed, OPNsense, NFS | 8-disk ZFS, NFS/Samba via LXC |
| rivendell | 192.168.0.202 | K8s worker host | Intel HD 530 iGPU, LAN on vmbr0 |
| isengard | 192.168.0.102 | K8s worker host | Intel HD 630 iGPU, LAN on vmbr0 |
| mirkwood | 192.168.0.8 | K8s CP host (metal0) | AMD Ryzen, LAN on vmbr1 |
| rohan | 192.168.0.7 | K8s CP host (metal1) | Intel, LAN on vmbr1 |
| gondor | 192.168.0.6 | K8s CP host (metal2) | Intel, LAN on vmbr1 |
| erebor | 192.168.0.101 | K8s + Bazzite host | NVIDIA GTX 1660 Ti, LAN on vmbr0 |

### Kubernetes Nodes (Talos VMs)

| Node | IP | VM ID | Proxmox Host | Bridge | Role | CPU | RAM | GPU |
|------|-----|-------|--------------|--------|------|-----|-----|-----|
| metal0 | 192.168.0.11 | 106 | mirkwood | vmbr1 | Control Plane | 4 | 44GB | — |
| metal1 | 192.168.0.12 | 107 | rohan | vmbr1 | Control Plane | 4 | 27GB | — |
| metal2 | 192.168.0.13 | 104 | gondor | vmbr1 | Control Plane | 4 | 27GB | — |
| metal3 | 192.168.0.14 | 114 | rivendell | vmbr0 | Worker | 4 | 10GB | Intel HD 530 |
| metal4 | 192.168.0.16 | 116 | isengard | vmbr0 | Worker | 4 | 10GB | Intel HD 630 |
| metal5 | 192.168.0.17 | 117 | erebor | vmbr0 | Worker | 6 | 5GB | — |

### Other VMs

| VM | IP | VM ID | Proxmox Host | Bridge | Purpose | CPU | RAM | Disk |
|----|-----|-------|--------------|--------|---------|-----|-----|------|
| bazzite | 192.168.0.15 | 120 | erebor | vmbr0 | Gaming + AI (GPU passthrough) | 4 | 10GB | 128GB |

> **Note on bridges**: mirkwood/rohan/gondor use `vmbr1` for LAN (vmbr0 = WAN via OPNsense). rivendell/erebor use `vmbr0` for LAN directly. Set `vm_network_bridge` per-node in the inventory.

### Network Configuration

- **Control Plane VIP**: 192.168.0.100 (Talos built-in VIP)
- **Pod CIDR**: 10.0.1.0/8
- **Service CIDR**: 10.43.0.0/16
- **LoadBalancer Pool**: 192.168.0.224/27 (Cilium L2 announcements)

## Prerequisites

### Required Tools

```bash
# Ansible 2.15+ with required collections
ansible-galaxy collection install -r requirements.yml

# talosctl CLI
curl -sL https://talos.dev/install | sh

# Python dependencies (needed for DHCP IP discovery and YAML processing)
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

### Talos ISO

The Talos ISO (`talos-v1.12.3-amd64.iso`) must be uploaded to `local` storage on each Proxmox node where VMs will be created.

## Directory Structure

```
metal/
  .env                          # Proxmox API credentials (gitignored)
  vault.yml                     # Ansible vault (Proxmox root password, gitignored)
  Makefile                      # Top-level targets
  requirements.yml              # Ansible collection dependencies
  ansible.cfg                   # Ansible configuration
  inventories/
    proxmox.yml                 # Proxmox host inventory (physical nodes)
    talos.yml                   # Talos node inventory (K8s VMs)
    bazzite.yml                 # Bazzite gaming VM inventory
  playbooks/
    proxmox-setup-node.yml      # Setup Proxmox nodes (repos, packages, GPU, cluster join)
    bazzite-create-vm.yml       # Create Bazzite gaming VM with automated kickstart install
    bazzite-post-install.yml    # Post-install: Ollama, Open WebUI, Sunshine, Moonlight, GPU
    talos-create-vms.yml        # Create VMs on Proxmox from Talos ISO
    talos-add-node.yml          # Add a node to an existing cluster
    talos-apply-configs.yml     # Apply Talos configs to all nodes
    talos-post-bootstrap.yml    # Post-bootstrap: kubeconfig + Cilium + CRDs
    talos-upgrade.yml           # Rolling upgrade
    ...
  roles/
    proxmox_setup/
      defaults/main.yml         # Package list, cluster join settings
      tasks/
        main.yml                # Repos, packages, Ceph, sysctl, fail2ban, cluster join
        gpu-passthrough.yml     # NVIDIA discrete GPU passthrough (VFIO-PCI binding)
        igpu-passthrough.yml    # Intel iGPU passthrough (i915 blacklist, IOMMU)
        resize-root.yml         # Shrink root LV via initramfs (free space for thin pool)
        safe-reboot.yml         # K8s-aware reboot (drain, reboot, wait, uncordon)
      handlers/main.yml         # Service restart handlers
    bazzite_vm/
      defaults/main.yml         # VM specs, ISO URL, kickstart defaults
      tasks/main.yml            # ISO download, kickstart, OEMDRV, VM create, boot
      templates/ks.cfg.j2       # Kickstart template (user, network, disk, ostree)
    bazzite_post_install/
      defaults/main.yml         # Software versions (Ollama, Open WebUI, flatpaks)
      tasks/
        main.yml                # Orchestrator
        ollama.yml              # Ollama install + systemd
        open-webui.yml          # Open WebUI podman container + systemd
        sunshine.yml            # Sunshine flatpak + udev config
        moonlight.yml           # Moonlight flatpak
        gpu-passthrough.yml     # Add GPU, clean up install artifacts
    talos_config/
      defaults/main.yml         # Cluster settings (CIDRs, extensions, cert SANs)
      tasks/main.yml            # Config generation + DHCP discovery + apply
      templates/
        common-patch.yaml.j2    # All nodes: DNS, NTP, kernel, CNI, subnets
        controlplane-patch.yaml.j2  # CP nodes: endpoint, scheduling
        worker-patch.yaml.j2    # Worker nodes: (placeholder for customization)
        node-patch.yaml.j2      # Per-node: hostname, IP, interface, VIP
  talos-configs/
    controlplane.yaml           # Base control plane config (generated once)
    worker.yaml                 # Base worker config (generated once)
    talosconfig                 # Talos client config
    patches/                    # Templated patches (generated by Ansible)
      common.yaml
      controlplane.yaml
      worker.yaml
      metal0.yaml ... metalN.yaml
```

## How the Config System Works

Talos machine configs are built from a **base config + layered patches**:

```
Base config (controlplane.yaml or worker.yaml)
  + common patch       (DNS, NTP, kernel modules, CIDRs, Cilium, API server args)
  + role patch          (CP: endpoint + scheduling, Worker: placeholder)
  + node patch          (hostname, static IP, network interface, VIP)
  = Final merged config (applied to the node)
```

The base configs are generated once with `talosctl gen config` and contain cluster secrets. Patches are templated from Ansible inventory variables on each run.

**Multi-document YAML handling**: `talosctl gen config` produces multi-document YAML (machine config + HostnameConfig). Since `--config-patch` doesn't work with multi-document files, the role extracts the first document, merges patches with `talosctl machineconfig patch`, then applies the merged result.

**DHCP IP discovery**: New VMs boot from the Talos ISO with a DHCP address, not their target static IP. The role automatically:
1. Checks if the node is reachable at its static IP
2. If not, gets the VM's MAC address from the Proxmox API
3. Scans the subnet for Talos API (port 50000), excluding known nodes
4. Applies the config to the discovered DHCP IP
5. Waits for the node to reboot with its static IP

## Setting Up a New Proxmox Node

### Step 1: Add to Inventory

Edit `inventories/proxmox.yml` and add the node under `proxmox_new.hosts`:

```yaml
proxmox_new:
  hosts:
    erebor:
      ansible_host: 192.168.0.101
      proxmox_join_cluster: true
      proxmox_create_vmbr1: false        # vmbr0 is LAN on this node
      proxmox_root_size: "50G"            # Optional: shrink root LV
      gpu_passthrough_ids: "10de:2182,10de:1aeb,10de:1aec,10de:1aed"  # Optional: NVIDIA GPU
      gpu_pci_address: "01:00"            # PCI address of the GPU
```

### Step 2: Create the Vault (First Time Only)

The vault stores the Proxmox root password for automated cluster join:

```bash
cd metal
ansible-vault create vault.yml
# Add: proxmox_root_password: "your-root-password"
```

### Step 3: Run the Playbook

```bash
cd metal
ansible-playbook -i inventories/proxmox.yml playbooks/proxmox-setup-node.yml \
  -l erebor --ask-vault-pass
```

This will:
1. Disable enterprise repos, enable no-subscription repos
2. Remove the Proxmox subscription nag
3. Run a full system upgrade
4. Install 40+ essential packages (monitoring, networking, storage tools)
5. Install Ceph Squid packages via `pveceph`
6. Apply sysctl performance and security tuning
7. Deploy SSH authorized key
8. Create vmbr1 bridge (if `proxmox_create_vmbr1: true`)
9. Configure fail2ban for Proxmox web UI
10. Join the Proxmox cluster (via `pvecm add` with password from vault)
11. Resize root LV (if `proxmox_root_size` is set) — see [Root LV Resize](#root-lv-resize)
12. Configure NVIDIA GPU passthrough (if `gpu_passthrough_ids` is set) — see [GPU Passthrough](#gpu-passthrough)
13. Configure Intel iGPU passthrough (if `igpu_passthrough: true`) — see [GPU Passthrough](#gpu-passthrough)

### Step 4: Verify

```bash
# Check in Proxmox UI
https://192.168.0.101:8006

# Check cluster membership
ssh root@<node-ip> pvecm status
```

### Moving to Existing

Once a node is set up, move it from `proxmox_new` to `proxmox_existing` in the inventory to avoid re-running cluster join on subsequent playbook runs.

### Running Against Existing Nodes

The playbook targets all `proxmox` hosts and processes them one at a time (`serial: 1`). This is safe for existing nodes — all tasks are idempotent. Use `-l` to target specific nodes:

```bash
# Run against a single existing node (e.g., apply GPU passthrough)
ansible-playbook -i inventories/proxmox.yml playbooks/proxmox-setup-node.yml \
  -l rohan --ask-vault-pass

# Run against all nodes (serial: 1 ensures one at a time)
ansible-playbook -i inventories/proxmox.yml playbooks/proxmox-setup-node.yml \
  --ask-vault-pass
```

## GPU Passthrough

The playbook supports two GPU passthrough modes, configured via inventory variables.

### NVIDIA Discrete GPU (VFIO-PCI)

For NVIDIA cards (e.g., GTX 1660 Ti on erebor), VFIO-PCI binding is configured at boot:

```yaml
# inventories/proxmox.yml
erebor:
  gpu_type: "NVIDIA GTX 1660 Ti"
  gpu_passthrough_ids: "10de:2182,10de:1aeb,10de:1aec,10de:1aed"  # All PCI functions
  gpu_pci_address: "01:00"
```

What it does:
1. Enables IOMMU (`intel_iommu=on iommu=pt`) in GRUB kernel parameters
2. Configures `vfio-pci.ids` to pre-bind the GPU at boot
3. Adds VFIO modules to initramfs
4. Blacklists nouveau/nvidia/nvidiafb drivers on the host
5. Configures KVM MSR ignore (prevents NVIDIA VM crashes)
6. Reboots safely (draining K8s VMs first if applicable)
7. Verifies IOMMU, VFIO modules, and GPU driver status

After setup, pass the GPU to a VM:
```bash
qm set <VMID> -hostpci0 01:00,pcie=1,x-vga=1
```

> **Finding PCI IDs**: Run `lspci -nn | grep -i nvidia` on the host to find all PCI function IDs for the GPU.

### Intel iGPU (i915 Blacklist)

For Intel integrated GPUs (e.g., Alder Lake-N UHD on rohan/gondor), the i915 driver is blacklisted so the iGPU can be passed through to VMs:

```yaml
# inventories/proxmox.yml
rohan:
  igpu_passthrough: true
  igpu_pci_address: "00:02"
```

What it does:
1. Checks runtime state first (IOMMU enabled? i915 blacklisted? VFIO loaded?)
2. **Skips all changes and reboots if already configured** (idempotent)
3. Enables IOMMU with ACS override for IOMMU group isolation
4. Blacklists i915, nouveau, nvidia, snd_hda_intel via kernel command line
5. Loads VFIO modules at boot via `/etc/modules`
6. Reboots safely if changes were made

After setup, pass the iGPU to a VM:
```bash
qm set <VMID> -hostpci0 00:02,pcie=1
```

> **Note on AMD GPUs**: AMD GPUs (e.g., Renoir on mirkwood) have a known reset bug that prevents reliable passthrough. This is not automated.

### Safe Reboot with K8s Awareness

All reboot-triggering tasks (GPU passthrough, root resize) use `safe-reboot.yml`, which handles Kubernetes gracefully:

1. **Drain**: `kubectl drain` each K8s node on the host (cordon + evict pods)
2. **Reboot**: Reboot the Proxmox host (300s timeout)
3. **Wait**: Pause 30s for VMs to start, then `kubectl wait --for=condition=Ready` with retries
4. **Uncordon**: `kubectl uncordon` to allow scheduling again
5. **Verify**: Print cluster node status

#### Standalone Reboot Playbook

To reboot a node on-demand (e.g., after BIOS changes, kernel updates):

```bash
# Reboot a single node (drains K8s first, uncordons after)
ansible-playbook -i inventories/proxmox.yml playbooks/proxmox-reboot-node.yml -l rohan

# Reboot with a reason (logged in the reboot message)
ansible-playbook -i inventories/proxmox.yml playbooks/proxmox-reboot-node.yml -l erebor -e "reason='Enable VT-d in BIOS'"

# Reboot ALL nodes one at a time (serial: 1 ensures cluster quorum)
ansible-playbook -i inventories/proxmox.yml playbooks/proxmox-reboot-node.yml
```

#### Recovery: Interrupted Reboot

If the playbook is interrupted after draining but before uncordoning (e.g., Ctrl+C, SSH drop, terminal crash), the K8s nodes will remain **cordoned** — no new pods will be scheduled on them.

Check for cordoned nodes:
```bash
kubectl get nodes
# Look for "SchedulingDisabled" in STATUS column
```

Uncordon specific nodes:
```bash
kubectl uncordon metal1
```

Uncordon all cordoned nodes at once:
```bash
kubectl get nodes -o name | xargs -I{} kubectl uncordon {}
```

#### Inventory Configuration

This requires `k8s_vm_nodes` in the inventory to map Proxmox hosts to their K8s VMs:

```yaml
# inventories/proxmox.yml
rohan:
  k8s_vm_nodes: [metal1]     # K8s nodes running on this Proxmox host
gondor:
  k8s_vm_nodes: [metal2]
erebor:
  k8s_vm_nodes: [metal5]
```

If `k8s_vm_nodes` is not defined for a host, it reboots normally without drain/uncordon.

Combined with `serial: 1` in the playbook, this ensures only one Proxmox host reboots at a time, maintaining cluster quorum.

## Root LV Resize

Proxmox defaults to a large root LV (often ~96G), leaving less space for the `pve/data` thin pool used for VM storage. The resize task shrinks the root LV and extends the thin pool.

### Configuration

```yaml
# inventories/proxmox.yml
erebor:
  proxmox_root_size: "50G"    # Target size for root LV
```

### How It Works

The resize is performed safely via an initramfs premount script that runs **before** root is mounted:

1. **Pre-check** (Ansible): Reads current LV size and disk usage. If usage >= target - 5G, prints a warning and **skips** the resize (playbook continues normally)
2. **Install initramfs scripts**: Adds `resize2fs` and `e2fsck` to initramfs, plus a premount script
3. **Reboot**: Triggers a safe reboot (with K8s drain if applicable)
4. **Initramfs resize** (runs at boot, before root mount):
   - `e2fsck -f -y` (filesystem check, required before shrink)
   - `resize2fs` to 2G below target (safety margin)
   - `lvreduce` to target size
   - `resize2fs` to fill LV (recover safety margin)
5. **Post-reboot**: Verifies sizes, extends `pve/data` thin pool with freed space, cleans up initramfs scripts

### Safety Features

- **Disk usage check**: If root uses more than target - 5G, the resize is skipped with a warning (playbook continues)
- **Initramfs abort**: If `resize2fs` shrink fails (filesystem too full), the script aborts before `lvreduce` — no data loss
- **Idempotent**: If root is already at or below target size, everything is skipped
- **Cleanup**: Initramfs resize scripts are removed after successful resize

### Example Output

```
Root LV:    50.00G
Filesystem: /dev/mapper/pve-root   49G  7.2G   40G  16% /
Thin pool:  399.87G
Extend:     Logical volume pve/data successfully resized
```

## Adding a Worker Node

### Step 1: Add to Inventory

Edit `inventories/talos.yml` and add the node under `talos_workers.hosts`:

```yaml
talos_workers:
  hosts:
    metal4:
      ansible_host: 192.168.0.16       # Target static IP
      proxmox_node: isengard            # Proxmox host to create VM on
      proxmox_host: 192.168.0.102      # Proxmox host IP (for API + SSH)
      vm_id: 116                        # Proxmox VM ID
      cpu: 4
      memory: 10240                     # RAM in MB
      disk_size: 50                     # Disk in GB
      network_interface: ens18          # NIC name inside Talos VM
      vm_network_bridge: vmbr0          # Proxmox bridge (vmbr0 or vmbr1)
      # Optional: Intel iGPU passthrough (host must have igpu_passthrough configured)
      igpu_passthrough: true
      igpu_pci_address: "00:02"
```

Also update `inventories/proxmox.yml` to add `k8s_vm_nodes` to the Proxmox host so safe-reboot logic knows which K8s nodes live there:

```yaml
isengard:
  k8s_vm_nodes: [metal4]    # Enables drain/uncordon during Proxmox host reboots
```

### Step 2: Upload Talos ISO

Ensure the Talos ISO is on the Proxmox node's local storage. Add the node to `proxmox_nodes` in `talos-upload-iso.yml` if not already listed, then:

```bash
cd metal
ansible-playbook -i inventories/proxmox.yml playbooks/talos-upload-iso.yml
```

### Step 3: Create the VM

```bash
ansible-playbook -i inventories/talos.yml playbooks/talos-create-vms.yml -l metal4
```

This creates the VM on Proxmox, attaches the Talos ISO, adds iGPU passthrough if configured (`igpu_passthrough: true`), and starts it. The VM boots into Talos maintenance mode with a DHCP address.

> **iGPU passthrough**: The playbook checks the VM config via SSH and adds `hostpci0` if not already set. This requires the Proxmox host to have iGPU passthrough configured (i915 blacklisted, VFIO loaded — done by `proxmox-setup-node.yml`). The PCI device is added before the first boot, so no stop/start cycle is needed.

### Step 4: Apply Config and Join Cluster

Wait ~60 seconds for the VM to boot, then:

```bash
ansible-playbook -i inventories/talos.yml playbooks/talos-add-node.yml -l metal4
```

This will:
1. Template all patch files from inventory variables
2. Discover the VM's DHCP IP (automatic subnet scan, excludes all known Talos nodes)
3. Merge patches into the base worker config (common + worker + node-specific)
4. Apply the merged config to the DHCP IP via `talosctl apply-config --insecure`
5. Wait for the node to reboot with its static IP
6. Verify the node joined the Kubernetes cluster as Ready

### Step 5: Verify

```bash
kubectl get nodes -o wide
# metal4 should appear as Ready within ~2 minutes
```

> **Kubelet serving certificates**: New nodes need their kubelet serving cert CSRs approved for metrics-server and Prometheus to scrape them. The `kubelet-csr-approver` controller (deployed via `system/kubelet-csr-approver/`) handles this automatically. If it's not yet deployed, approve manually: `kubectl certificate approve $(kubectl get csr -o name)`

### Adding Multiple Nodes at Once

Multiple workers can be added in one command — the playbook processes nodes one at a time (`serial: 1`) to avoid DHCP discovery collisions:

```bash
# Create VMs
ansible-playbook -i inventories/talos.yml playbooks/talos-create-vms.yml -l metal4,metal5

# Wait ~60s for boot, then join
ansible-playbook -i inventories/talos.yml playbooks/talos-add-node.yml -l metal4,metal5
```

## Complete Deployment Workflow (Fresh Cluster)

### Step 1: Create VMs

```bash
ansible-playbook -i inventories/talos.yml playbooks/talos-create-vms.yml
```

### Step 2: Apply Talos Configurations

```bash
# Wait ~60s for VMs to boot, then:
ansible-playbook -i inventories/talos.yml playbooks/talos-apply-configs.yml
```

### Step 3: Bootstrap the Cluster

```bash
talosctl --talosconfig talos-configs/talosconfig bootstrap --nodes 192.168.0.11
```

### Step 4: Post-Bootstrap Setup

```bash
# Deploy Cilium CNI, configure networking, get kubeconfig
ansible-playbook playbooks/talos-post-bootstrap.yml
```

### Step 5: Deploy Storage

```bash
ansible-playbook playbooks/talos-deploy-storage.yml
```

### Step 6: Deploy Ingress Controller

```bash
ansible-playbook playbooks/talos-deploy-ingress.yml
```

### Step 7: Bootstrap GitOps (Secrets + ArgoCD)

```bash
cd /workspaces/portkey
make bootstrap
# (prompts for Ansible vault password)
```

### Step 8: External Secrets (Terraform)

```bash
make external
```

### Full Bootstrap (One-liner)

```bash
cd /workspaces/portkey
make          # metal + bootstrap + external
make post-install  # Kanidm OAuth setup (needs running pods)
```

## Bazzite Gaming VM

Bazzite is a Fedora Atomic (rpm-ostree) gaming distro deployed on erebor with NVIDIA GTX 1660 Ti GPU passthrough. The VM runs Ollama + Open WebUI for AI inference and Sunshine + Moonlight for game streaming.

### Architecture

The deployment uses a **two-stage install** because direct Bazzite ISO kickstart is broken ([ublue-os/bazzite#3418](https://github.com/ublue-os/bazzite/issues/3418) — missing SELinux labels cause Anaconda D-Bus crashes):

1. **Phase 1** (`bazzite-create-vm.yml`): Kickstart installs **Fedora Kinoite** as a base OS (proven kickstart support, proper SELinux labels). Downloads the Kinoite ISO (~3.5 GB), generates kickstart + OEMDRV, creates VM, boots installer.
2. **Phase 2** (`bazzite-post-install.yml`): Rebases from Kinoite to **Bazzite NVIDIA Open** via `rpm-ostree rebase`, reboots, then installs Ollama, Open WebUI, Sunshine, Moonlight, and adds GPU passthrough.

After Phase 2, the VM must be **stopped and started** (not rebooted) for PCIe passthrough to take effect. After restart, the GPU becomes the primary display — Proxmox VNC console no longer works, use SSH or Sunshine instead.

### USB Passthrough

USB devices are passed through by **physical port number** (not device ID), so you can plug any device into a dedicated VM port and it works without reconfiguring. The Intel Bluetooth adapter is passed by device ID since it's an internal motherboard header.

#### erebor USB Port Map

| Label | Bus 1 (USB 2.0) | Bus 2 (USB 3.0) | USB Standard | Assigned To |
|-------|-----------------|-----------------|-------------|-------------|
| Port A | 1-8 | — | USB 2.0 only | VM |
| Port B | 1-3 | 2-3 | USB 3.0 | VM |
| Port C | 1-9 | — | USB 2.0 only | VM |
| Port D | 1-6 | 2-6 | USB 3.0 | VM |
| Port E | 1-5 | 2-5 | USB 3.0 | VM |
| SanDisk port | 1-1 | 2-1 | USB 3.0 | **Host** (reserved for 2.5G Ethernet) |
| Internal | 1-10 | — | USB 2.0 only | Host (ASUS ITE motherboard) |
| Internal | 1-14 | — | USB 2.0 only | VM (Intel Bluetooth, by device ID) |

- **USB 3.0 hard drives**: Use ports B, D, or E (USB 3.0 capable)
- **Mice, keyboards, controllers**: Any VM port works (USB 2.0 is sufficient)
- **2.5G Ethernet adapter**: Must use the SanDisk/host port (USB 3.0 needed for 2.5 Gbps — USB 2.0 maxes out at 480 Mbps)
- **Xbox controller**: Pair via Bluetooth, or plug Xbox Wireless Adapter into any VM port

> **Port mapping method**: Bus 1 port N pairs with Bus 2 port N (for N=1-6) on Intel Cannon Lake PCH xHCI. Verified via ACPI `_ADR` values from firmware. Ports 7+ on Bus 1 are USB 2.0 only (no SuperSpeed companion).

### Automated Kickstart Install

The Fedora Kinoite base install is automated using:

- **Kickstart file** (`ks.cfg.j2`): Configures language, keyboard, timezone, static networking, user account, disk partitioning, and `ostreesetup` for Fedora Kinoite deployment
- **OEMDRV ISO**: Anaconda auto-detects kickstart files on volumes labeled `OEMDRV`. The playbook creates a small ISO containing `ks.cfg` and attaches it as a SATA CDROM

### Software Stack

| Software | Install Method | Service | Port | Notes |
|----------|---------------|---------|------|-------|
| Ollama | Podman container (`docker.io/ollama/ollama`) | `container-ollama.service` (systemd) | 11434 | `--device nvidia.com/gpu=all` for GPU access |
| Open WebUI | Podman container (`ghcr.io/open-webui/open-webui:main`) | `container-open-webui.service` (systemd) | 3000 | Connects to Ollama at `127.0.0.1:11434` |
| Sunshine | Flatpak (`dev.lizardbyte.app.Sunshine`) | Flatpak app | 47990 (web UI) | udev rule for uinput access, flatpak overrides for GPU |
| Moonlight | Flatpak (`com.moonlight_stream.Moonlight`) | Flatpak app | — | Game streaming client (connects to another Sunshine host) |

### Creating a Bazzite VM from Scratch

#### Prerequisites

1. Proxmox node set up with GPU passthrough configured (see [GPU Passthrough](#gpu-passthrough))
2. `.env` file with Proxmox API credentials
3. SSH access to the Proxmox node (for ISO download via wget)

#### Step 1: Add to Inventory

Edit `inventories/bazzite.yml` (or create it from the existing one):

```yaml
bazzite_vms:
  hosts:
    bazzite-erebor:
      ansible_host: 192.168.0.15
      ansible_user: bazzite
      ansible_become: true
      proxmox_node: erebor
      proxmox_host: 192.168.0.101
      vm_id: 120
      vm_name: bazzite
      cpu: 4
      memory: 10240
      disk_size: 128
      vm_storage: local-lvm
      vm_network_bridge: vmbr0
      gpu_pci_address: "01:00"
      gpu_passthrough_ids: "10de:2182,10de:1aeb,10de:1aec,10de:1aed"

      # USB passthrough (port-based for external, device-ID for internal)
      usb_passthrough_devices:
        - port: "1-3"              # External port B (USB 2.0)
        - port: "2-3"              # External port B (USB 3.0)
        - port: "1-5"              # External port E (USB 2.0)
        - port: "2-5"              # External port E (USB 3.0)
        - port: "1-6"              # External port D (USB 2.0)
        - port: "2-6"              # External port D (USB 3.0)
        - port: "1-8"              # External port A (USB 2.0 only)
        - port: "1-9"              # External port C (USB 2.0 only)
        - id: "8087:0aaa"          # Intel Bluetooth (internal header)
```

> **Finding GPU PCI address and IDs**: SSH into the Proxmox host and run `lspci -nn | grep -i nvidia`. The PCI address is the first field (e.g., `01:00.0`), use just the bus:device part (`01:00`). The IDs are in brackets (e.g., `[10de:2182]`), collect all functions.
>
> **Mapping USB ports**: USB ports are identified by `<bus>-<port>`. Use `lsusb -t` to see which bus/port a device is on, then move it between physical ports to build a map. USB 3.0 ports have two entries: one on Bus 1 (USB 2.0 side) and one on Bus 2 (USB 3.0 side). Both must be passed through for full USB 3.0 speed. Use `port:` for physical port passthrough (any device plugged in works) or `id:` for device-ID passthrough (specific device only).

#### Step 2: Create the VM (Phase 1)

```bash
cd metal
ansible-playbook -i inventories/bazzite.yml playbooks/bazzite-create-vm.yml
```

This will:
1. Download the Fedora Kinoite ISO to the Proxmox node (~3.5 GB)
2. Remove any old Bazzite ISO (no longer needed)
3. Generate a kickstart file and OEMDRV ISO
4. Create the VM (UEFI/q35/VGA) and attach both ISOs
5. Start the VM — Anaconda auto-detects OEMDRV kickstart
6. Wait for SSH to come up (up to 20 minutes)

The playbook finishes when the Kinoite install completes and SSH is available.

The combined playbook continues automatically into Phase 2:

1. Verify SSH connectivity
2. Wait for rpm-ostree to be idle
3. **Rebase to Bazzite NVIDIA Open** (`rpm-ostree rebase`) and reboot
4. Install Sunshine and Moonlight via Flatpak
5. Add GPU passthrough to VM config (removes install artifacts, adds `hostpci0`)
6. **Stop + start** the VM to activate PCIe passthrough
7. Install Ollama (podman container with NVIDIA GPU) and verify API
8. Deploy Open WebUI as a Podman container with systemd unit
9. Print a summary with service URLs

#### Step 3: Verify

```bash
# Check GPU is visible inside the VM
ssh bazzite@192.168.0.15 nvidia-smi

# Check Ollama (will now use GPU)
curl http://192.168.0.15:11434/api/tags

# Access Open WebUI
# Browser: http://192.168.0.15:3000

# Access Sunshine web UI (first-run setup)
# Browser: https://192.168.0.15:47990
```

### Recreating the VM

If erebor is rebuilt or the VM needs to be recreated from scratch:

```bash
cd metal

# 1. Setup Proxmox node (if rebuilt)
ansible-playbook -i inventories/proxmox.yml playbooks/proxmox-setup-node.yml \
  -l erebor --ask-vault-pass

# 2. Create VM + full deployment (destroy existing, then install everything)
ansible-playbook -i inventories/bazzite.yml playbooks/bazzite-create-vm.yml -e recreate=true
```

The single command handles everything: kickstart install, rebase to Bazzite, software install, GPU passthrough, and stop+start.

## Common Operations

### Access the Cluster

```bash
export TALOSCONFIG=$(pwd)/talos-configs/talosconfig
export KUBECONFIG=$(pwd)/kubeconfig.yaml

talosctl health
kubectl get nodes -o wide
talosctl dashboard
```

### Upgrade Talos

```bash
# Rolling upgrade (one node at a time)
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
talosctl logs kubelet --nodes 192.168.0.11
talosctl logs etcd --nodes 192.168.0.11
talosctl dmesg --nodes 192.168.0.11
```

### Reboot a Node

```bash
talosctl reboot --nodes 192.168.0.12
```

## Playbook Reference

| Playbook | Inventory | Purpose | Usage |
|----------|-----------|---------|-------|
| `proxmox-setup-node.yml` | `proxmox.yml` | Setup Proxmox node (repos, packages, GPU, resize, cluster join). Runs `serial: 1`. | `-l <node> --ask-vault-pass` |
| `proxmox-reboot-node.yml` | `proxmox.yml` | Safely reboot a node (drain K8s, reboot, uncordon). Runs `serial: 1`. | `-l <node>` required |
| `talos-create-vms.yml` | `talos.yml` | Create VMs on Proxmox from Talos ISO | `-l <node>` to target specific nodes |
| `talos-add-node.yml` | `talos.yml` | Add node to existing cluster (discover IP, apply config, verify) | `-l <node>` required |
| `talos-apply-configs.yml` | `talos.yml` | Apply machine configs (for fresh deploy, all nodes) | Optional `-l <node>` |
| `talos-post-bootstrap.yml` | `talos.yml` | Kubeconfig + Cilium + networking + CRDs | Run once after bootstrap |
| `talos-install-cilium.yml` | `talos.yml` | Install Cilium CNI (called by post-bootstrap) | |
| `talos-deploy-cilium.yml` | `talos.yml` | Alternative Cilium install via Ansible helm module | |
| `talos-configure-networking.yml` | `talos.yml` | L2 announcements and LB IP pools | |
| `talos-install-crds.yml` | `talos.yml` | Pre-install CRDs to prevent race conditions | |
| `talos-deploy-storage.yml` | `talos.yml` | Deploy Rook Ceph and NFS CSI | |
| `talos-deploy-ingress.yml` | `talos.yml` | Deploy NGINX Ingress Controller | |
| `talos-upgrade.yml` | `talos.yml` | Rolling upgrade of all nodes (one at a time) | |
| `talos-upload-iso.yml` | `talos.yml` | Upload Talos ISO to Proxmox nodes | |
| `bazzite-create-vm.yml` | `bazzite.yml` | Full Bazzite deployment (Kinoite kickstart + rebase + software + GPU). Use `-e recreate=true` to destroy existing. | |
| `bazzite-post-install.yml` | `bazzite.yml` | Post-install only (rebase, software, GPU). Normally called by bazzite-create-vm. | |

## Inventory Variables Reference

### Proxmox Inventory (`inventories/proxmox.yml`)

#### Global Variables (`all.vars`)

| Variable | Description | Default |
|----------|-------------|---------|
| `ansible_user` | SSH user for Proxmox hosts | `root` |
| `proxmox_cluster_seed` | Existing cluster node IP for `pvecm add` | `192.168.0.2` |
| `ceph_repo` | Ceph repo matching cluster version | `ceph-squid` |

#### Per-Node Variables (Proxmox Hosts)

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `ansible_host` | Proxmox host IP | Yes | — |
| `proxmox_join_cluster` | Join the Proxmox cluster on setup | No | `false` |
| `proxmox_create_vmbr1` | Create vmbr1 bridge for K8s VMs | No | `true` |
| `proxmox_root_size` | Target root LV size (e.g., `"50G"`) | No | — (skip resize) |
| `k8s_vm_nodes` | List of K8s node names running on this host | No | `[]` |
| `gpu_passthrough_ids` | NVIDIA PCI device IDs for VFIO-PCI binding | No | — (skip GPU) |
| `gpu_type` | GPU description (for logging) | No | `"NVIDIA"` |
| `gpu_pci_address` | PCI address of discrete GPU | No | `"01:00"` |
| `igpu_passthrough` | Enable Intel iGPU passthrough | No | `false` |
| `igpu_pci_address` | PCI address of Intel iGPU | No | `"00:02"` |

### Talos Inventory (`inventories/talos.yml`)

#### Global Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `control_plane_endpoint` | VIP for API server | `192.168.0.100` |
| `talos_version` | Talos Linux version | `v1.12.3` |
| `kubernetes_version` | Kubernetes version | `v1.33.0` |

#### Per-Node Variables (Talos VMs)

| Variable | Description | Required |
|----------|-------------|----------|
| `ansible_host` | Target static IP address | Yes |
| `proxmox_node` | Proxmox host name | Yes |
| `proxmox_host` | Proxmox host IP | Yes |
| `vm_id` | Proxmox VM ID | Yes |
| `cpu` | Number of CPU cores | Yes |
| `memory` | RAM in MB | Yes |
| `disk_size` | Disk size in GB | No (default: 50) |
| `network_interface` | NIC name in Talos (ens18, eth0) | Yes |
| `vm_network_bridge` | Proxmox bridge name | No (default: vmbr1) |
| `talos_vip_enabled` | Assign VIP to this node | No (default: false) |
| `igpu_passthrough` | Add Intel iGPU passthrough to VM | No (default: false) |
| `igpu_pci_address` | PCI address of Intel iGPU | No (default: `00:02`) |

### Role Defaults (`talos_config/defaults/main.yml`)

| Variable | Description |
|----------|-------------|
| `pod_subnet` | Pod CIDR (10.0.1.0/8) |
| `service_subnet` | Service CIDR (10.43.0.0/16) |
| `dns_servers` | DNS resolvers |
| `cert_sans` | API server certificate SANs |
| `talos_image_factory_schematic` | Image Factory schematic ID for extensions |
| `kernel_modules` | Kernel modules to load (i915) |

### Bazzite Inventory (`inventories/bazzite.yml`)

#### Global Variables (`all.vars`)

| Variable | Description | Default |
|----------|-------------|---------|
| `proxmox_api_host` | Proxmox API endpoint IP | From `PROXMOX_HOST` env var |
| `proxmox_user` | Proxmox API user | From `PROXMOX_USER` env var |
| `proxmox_token_id` | Proxmox API token ID | From `PROXMOX_TOKEN_ID` env var |
| `proxmox_token_secret` | Proxmox API token secret | From `PROXMOX_TOKEN_SECRET` env var |

#### Per-Host Variables (`bazzite_vms.hosts`)

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `ansible_host` | VM static IP address | Yes | — |
| `ansible_user` | SSH user for the VM | No | `bazzite` |
| `proxmox_node` | Proxmox host name | Yes | — |
| `proxmox_host` | Proxmox host IP | Yes | — |
| `vm_id` | Proxmox VM ID | Yes | — |
| `vm_name` | VM name in Proxmox | No | inventory hostname |
| `cpu` | Number of CPU cores | No | `4` |
| `memory` | RAM in MB | No | `10240` |
| `disk_size` | Disk size in GB | No | `128` |
| `vm_storage` | Proxmox storage for disk | No | `local-lvm` |
| `vm_network_bridge` | Proxmox bridge name | No | `vmbr0` |
| `gpu_pci_address` | GPU PCI address (e.g., `01:00`) | Yes | — |
| `gpu_passthrough_ids` | GPU PCI device IDs for VFIO | Yes | — |
| `usb_passthrough_devices` | List of USB devices/ports to pass to VM (see [USB Passthrough](#usb-passthrough)) | No | `[]` |
| `bazzite_password` | User password for kickstart | No | `bazzite` |
| `bazzite_netmask` | Network mask | No | `255.255.255.0` |
| `bazzite_gateway` | Default gateway | No | `192.168.0.1` |
| `bazzite_dns` | DNS servers (comma-separated) | No | `192.168.0.1,8.8.8.8` |
| `base_iso` | Fedora Kinoite ISO filename | No | `Fedora-Kinoite-ostree-x86_64-42-1.1.iso` |
| `base_iso_url` | Kinoite ISO download URL | No | Fedora mirror URL |
| `bazzite_image` | Bazzite container image for rebase | No | `ostree-unverified-registry:ghcr.io/ublue-os/bazzite-nvidia-open:stable` |
| `iso_storage` | Proxmox storage for ISOs | No | `local` |

## Troubleshooting

### Node not accessible

```bash
# Check if Talos API is responding
talosctl version --nodes 192.168.0.11

# Check VM console via Proxmox UI to see boot status
```

### New node stuck on DHCP / didn't get config

```bash
# Find what IP the node got via DHCP (scan for Talos API port)
python3 -c "
import socket, concurrent.futures
def check(ip):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.5)
        r = s.connect_ex((ip, 50000))
        s.close()
        return ip if r == 0 else None
    except: return None
with concurrent.futures.ThreadPoolExecutor(max_workers=50) as ex:
    found = [r for r in ex.map(check, [f'192.168.0.{i}' for i in range(1,255)]) if r]
print('Talos API found at:', found)
"

# Manually apply config to a known DHCP IP
talosctl apply-config --insecure --nodes 192.168.0.57 --file /tmp/metal3-config.yaml
```

### VM bridge error on Proxmox

If VM creation fails with `bridge 'vmbr1' does not exist`:
- Check which bridges exist: Proxmox UI > Node > Network
- Set `vm_network_bridge` in inventory for that node
- rivendell uses `vmbr0`, mirkwood/rohan/gondor use `vmbr1`

### Kubelet metrics not working on new node (TLS error)

If `kubectl top node <name>` shows `<unknown>` or metrics-server logs show `tls: internal error`, the kubelet serving certificate CSR hasn't been approved:

```bash
# Check for pending CSRs
kubectl get csr

# If kubelet-csr-approver is deployed, CSRs are approved automatically.
# Otherwise, approve manually:
kubectl certificate approve <csr-name>
```

The `kubelet-csr-approver` controller (`system/kubelet-csr-approver/`) auto-approves these CSRs for nodes matching IP prefix `192.168.0.0/24` and hostname patterns `metalN` or `talos-*`.

### Cilium not starting on new worker

```bash
kubectl get pods -n kube-system -l app.kubernetes.io/name=cilium
kubectl logs -n kube-system -l app.kubernetes.io/name=cilium --tail=50
```

### Config patch fails with "JSON6902 patches not supported"

This happens when the base config is multi-document YAML. The `talos_config` role handles this automatically by extracting the first document before patching. If applying manually:

```bash
# Extract first document
python3 -c "import yaml; docs=list(yaml.safe_load_all(open('worker.yaml'))); yaml.dump(docs[0], open('/tmp/worker-single.yaml','w'), default_flow_style=False)"

# Patch and apply
talosctl machineconfig patch /tmp/worker-single.yaml \
  --patch @patches/common.yaml \
  --patch @patches/worker.yaml \
  --patch @patches/metal3.yaml \
  --output /tmp/metal3-config.yaml

talosctl apply-config --insecure --nodes <DHCP-IP> --file /tmp/metal3-config.yaml
```

### Bazzite kickstart install hangs or fails

If the Kinoite kickstart install doesn't complete (VM doesn't power off):

1. Check the Proxmox VNC console (Proxmox UI > erebor > VM 120 > Console)
2. Common issues:
   - **"No OEMDRV found"**: The OEMDRV ISO wasn't attached. Check `qm config 120` for `sata1`
   - **Reinstall loop**: Boot order still has ISO first. Check `qm config 120` for `boot:` — should be `order=scsi0` after first start
   - **Network timeout**: Verify the static IP and gateway are correct in the inventory
3. Destroy and retry: `ansible-playbook -i inventories/bazzite.yml playbooks/bazzite-create-vm.yml -e recreate=true`

### Bazzite VM no display after GPU passthrough

After GPU passthrough is enabled (`vga: none`), the Proxmox VNC console shows a blank screen. This is expected. Access the VM via:

```bash
# SSH
ssh bazzite@192.168.0.15

# Sunshine web UI (after first-run setup)
# Browser: https://192.168.0.15:47990
```

### Ollama not using GPU

If `nvidia-smi` works but Ollama doesn't use the GPU:

```bash
ssh bazzite@192.168.0.15

# Check Ollama sees the GPU
curl http://localhost:11434/api/tags
ollama run llama3 --verbose  # Check for GPU info in output

# Restart Ollama to re-detect
sudo systemctl restart ollama
```

Ollama auto-detects NVIDIA GPUs on startup. If the GPU was added after Ollama was installed (before the stop+start cycle), a restart is needed.

### Open WebUI not connecting to Ollama

Open WebUI runs with `--network host` and connects to `http://127.0.0.1:11434`. If it can't reach Ollama:

```bash
ssh bazzite@192.168.0.15

# Check both services are running
sudo systemctl status ollama
sudo systemctl status container-open-webui

# Check Ollama is listening
curl http://127.0.0.1:11434/api/tags

# Restart Open WebUI
sudo systemctl restart container-open-webui
```

## System Extensions (Image Factory)

Talos uses an immutable root filesystem. Kernel modules like i915 (Intel GPU) are added via [Talos Image Factory](https://factory.talos.dev).

### Current Extensions

| Extension | Purpose |
|-----------|---------|
| `i915-ucode` | Intel GPU firmware + i915 kernel module |

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
4. Run the upgrade playbook: `ansible-playbook -i inventories/talos.yml playbooks/talos-upgrade.yml`

### Verifying Extensions

```bash
talosctl -n 192.168.0.11 get extensions
talosctl -n 192.168.0.11 read /proc/modules | grep i915
talosctl -n 192.168.0.11 ls /dev/dri/
```

---

**Last Updated**: 2026-02-11
**Status**: 7-node Proxmox cluster, 6-node K8s cluster (3 CP + 3 workers) running Talos v1.12.3 / K8s v1.35.0, Bazzite gaming VM on erebor
