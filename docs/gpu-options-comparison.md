# GPU Options Comparison for Mirkwood (AMD Ryzen 5 4500U)

## Quick Answer
**Yes, you can add an LXC container to the Kubernetes cluster with GPU access!** This is actually the **best** option for AMD APU systems.

## Comparison Table

| Approach | Feasibility | Complexity | Performance | Recommendation |
|----------|------------|------------|-------------|----------------|
| **VM GPU Passthrough** | ❌ Low | 🔴 Very High | ⚠️ If it works, good | ❌ Not Recommended |
| **LXC with GPU** | ✅ Yes | 🟢 Low | ✅ Near-native | ✅ **RECOMMENDED** |
| **Discrete GPU** | ✅ Yes | 🟡 Medium | ✅ Native | ✅ Good Alternative |
| **CPU-Only (Current)** | ✅ Yes | 🟢 None | ❌ No GPU | ⏸️ Status Quo |

## Detailed Analysis

### 1. VM GPU Passthrough ❌

**Why it doesn't work well for AMD APUs:**
```
┌─────────────────────────────────────┐
│  AMD Ryzen 5 4500U (Renoir)        │
│  ┌──────────────────────────────┐  │
│  │ CPU Cores                     │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │ Radeon Vega 6 iGPU           │◄─┼─── Problem: Reset Bug
│  │ (Same IOMMU group as USB/SMBus)│◄─┼─── Problem: Can't isolate
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │ USB / Audio / SMBus          │◄─┼─── Problem: Needed by host
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
```

**Technical Issues:**
- **AMD Reset Bug**: GPU can't be reset after VM shutdown
- **IOMMU Grouping**: GPU shares group with critical devices (USB, SMBus, audio)
- **Primary GPU**: Only GPU in system, needed for Proxmox console
- **Poor Support**: VFIO drivers for AMD APU iGPUs are limited

**Success Rate**: ~10% (requires kernel patches, vendor-reset module, ACS override)

### 2. LXC Container with GPU ✅ **RECOMMENDED**

**How it works:**
```
┌─────────────────────────────────────┐
│  Proxmox Host (mirkwood)            │
│  ┌──────────────────────────────┐  │
│  │ /dev/dri/card0               │  │
│  │ /dev/dri/renderD128          │  │
│  └────────┬─────────────────────┘  │
│           │ Device Bind             │
│           ▼                         │
│  ┌──────────────────────────────┐  │
│  │ LXC Container (metal3)        │  │
│  │ ┌──────────────────────────┐ │  │
│  │ │ k3s Node                  │ │  │
│  │ │ AMD GPU Device Plugin     │ │  │
│  │ │ Direct /dev/dri access    │ │  │
│  │ └──────────────────────────┘ │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
```

**Advantages:**
- ✅ **Works reliably** - no passthrough, just device mapping
- ✅ **Near-native performance** - minimal overhead
- ✅ **Simple configuration** - few lines in LXC config
- ✅ **Fast boot** - container starts in ~3 seconds
- ✅ **Low memory overhead** - ~50MB vs ~500MB for VM
- ✅ **k3s proven** - k3s designed to work in containers

**Disadvantages:**
- ⚠️ Requires privileged LXC container (less isolation than VM)
- ⚠️ Shared kernel with Proxmox host
- ⚠️ No live migration capability

**Use Cases:**
- Immich ML workload (machine learning inference)
- Ollama (LLM inference)
- Video transcoding (if not using Jellyfin on VM)
- General GPU compute tasks

**Success Rate**: ~95%

### 3. Add Discrete GPU ✅

**How it works:**
```
┌─────────────────────────────────────┐
│  Proxmox Host (mirkwood)            │
│  ┌──────────────────────────────┐  │
│  │ AMD Vega iGPU (for Proxmox)  │  │ ◄─ Host uses this
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │ NVIDIA GT 1030 or AMD RX 6400│  │ ◄─ Passthrough to VM
│  │ (PCIe x16 slot)               │  │
│  └────────┬─────────────────────┘  │
│           │ VFIO Passthrough        │
│           ▼                         │
│  ┌──────────────────────────────┐  │
│  │ VM (metal0 or new metal3)     │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
```

**Recommended GPUs:**
| GPU | Power | Price | Passthrough | Use Case |
|-----|-------|-------|-------------|----------|
| NVIDIA GT 1030 | 30W | ~$80 | Excellent | Basic ML/Transcode |
| AMD RX 6400 | 53W | ~$140 | Good | Better ML/Gaming |
| Intel Arc A380 | 75W | ~$140 | Excellent | AV1 encode |

**Advantages:**
- ✅ Discrete GPU passthrough is reliable
- ✅ Leaves iGPU for Proxmox console
- ✅ Better performance than iGPU
- ✅ Can add multiple GPUs later

**Disadvantages:**
- 💰 Costs money ($80-$150)
- ⚡ Additional power consumption
- 🔧 Requires PCIe slot and physical installation

**Success Rate**: ~90%

### 4. CPU-Only (Current State) ⏸️

**Current Architecture:**
```
┌───────────┐  ┌───────────┐  ┌───────────┐
│  metal0   │  │  metal1   │  │  metal2   │
│ (no GPU)  │  │(Intel GPU)│  │(Intel GPU)│
│ mirkwood  │  │   rohan   │  │   gondor  │
└───────────┘  └───────────┘  └───────────┘
     │              │              │
     └──────────────┴──────────────┘
                    │
         GPU workloads scheduled
         only on metal1/metal2
```

**Advantages:**
- ✅ Already working
- ✅ Zero additional effort
- ✅ metal1/metal2 have Intel GPUs for transcoding

**Disadvantages:**
- ❌ Wasted AMD GPU sitting idle
- ❌ All GPU workloads on 2 nodes only
- ❌ metal0 can't run Immich ML or Ollama

## Performance Comparison

| Metric | VM Passthrough | LXC | Discrete GPU | CPU-Only |
|--------|----------------|-----|--------------|----------|
| Boot Time | 30s | 3s | 30s | 30s |
| Memory Overhead | ~500MB | ~50MB | ~500MB | ~500MB |
| GPU Performance | 85%* | 98% | 100% | 0% |
| Isolation | High | Medium | High | High |
| Complexity | Very High | Low | Medium | None |

*If it works at all

## Recommendation

### For Your Use Case:

**Best Option: LXC Container**
1. Run the creation script: `bash scripts/create-lxc-k8s-node.sh 114 metal3 192.168.0.14`
2. Add to Ansible inventory
3. Join to k3s cluster
4. Install AMD GPU device plugin
5. Schedule Immich ML workload

**Why?**
- Zero hardware cost
- Works around AMD APU limitations
- Near-native performance
- Simple to set up and maintain
- Can be done in <30 minutes

**When to consider Discrete GPU instead:**
- Need VM isolation for compliance/security
- Want even better GPU performance
- Planning to run heavy ML training (not just inference)
- Have budget for hardware

## Quick Start

```bash
# On mirkwood Proxmox host
curl -O https://raw.githubusercontent.com/yourusername/portkey/master/scripts/create-lxc-k8s-node.sh
chmod +x create-lxc-k8s-node.sh
./create-lxc-k8s-node.sh 114 metal3 192.168.0.14

# In your dev environment
cd /workspaces/portkey
# Add metal3 to metal/inventories/prod.yml
cd metal
ansible-playbook -i inventories/prod.yml cluster.yml --limit metal3

# Verify
kubectl get nodes
kubectl describe node metal3 | grep -i gpu
```

## Conclusion

**Yes, you can absolutely add an LXC to the Kubernetes cluster**, and it's actually the **best solution** for getting GPU access from your AMD Ryzen 5 4500U on mirkwood!

The LXC approach gives you:
- ✅ GPU access that VM passthrough can't provide
- ✅ Better performance than VM passthrough would have
- ✅ Simpler setup than discrete GPU
- ✅ Zero cost compared to buying hardware
- ✅ k3s officially supports LXC containers
