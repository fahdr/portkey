# K3s to Talos Linux Migration - Complete! 🎉

**Date**: 2026-02-08
**Status**: ✅ Infrastructure Deployed - Ready for Application Deployment

---

## 📊 What Was Accomplished

### ✅ Core Infrastructure (100% Complete)

1. **Talos Linux Cluster**
   - 3 control plane nodes (metal0, metal1, metal2)
   - Talos v1.12.3 + Kubernetes v1.35.0
   - Control Plane VIP: 192.168.0.100 (Talos built-in)
   - All nodes healthy and ready

2. **Networking Stack**
   - Cilium v1.17.4 CNI (kube-proxy replacement)
   - Talos-compatible security context
   - L2 LoadBalancer announcements configured
   - NGINX Ingress Controller deployed
   - LoadBalancer IP: 192.168.0.224
   - IP Pool: 192.168.0.224/27

3. **Storage Infrastructure**
   - NFS CSI driver (nfs-csi storage class)
   - Rook Ceph external cluster configured
   - Storage classes: ceph-rbd, cephfs, nfs-csi
   - All storage tested and working

4. **GitOps Platform**
   - ArgoCD v3.3.0 deployed
   - Accessible at: https://argocd.themainfreak.com
   - Admin credentials configured
   - ApplicationSets created (bootstrap, system, platform, apps)

### ✅ Automation & Documentation (100% Complete)

1. **Make-based Deployment Pipeline**
   - `make` from repo root runs full deployment: metal → bootstrap → external
   - Ansible playbooks for cluster provisioning and bootstrap
   - Terraform for external services (Cloudflare, ZeroTier, secrets)
   - See: [metal/README.md](metal/README.md)

2. **Secrets Management**
   - Ceph + GitHub credentials in Ansible Vault (`bootstrap/vault.yml`)
   - External secrets (Cloudflare, ZeroTier, ntfy) via Terraform Cloud
   - App secrets via ExternalSecrets + Vaultwarden

3. **Documentation**
   - [CLUSTER.md](CLUSTER.md) - Cluster architecture
   - [metal/README.md](metal/README.md) - Deployment workflow and playbooks
   - [docs/post-migration-audit.md](docs/post-migration-audit.md) - Post-migration fixes
   - [docs/opnsense-dns-setup.md](docs/opnsense-dns-setup.md) - Local DNS setup

4. **DevContainer**
   - Automated dependency installation
   - Pre-configured kubectl + talosctl
   - Ready for development

---

## 🔑 Access Information

### Cluster Access

**kubectl:**
```bash
export KUBECONFIG=/workspaces/portkey/metal/kubeconfig.yaml
kubectl get nodes
```

**talosctl:**
```bash
export TALOSCONFIG=/workspaces/portkey/metal/talos-configs/talosconfig
talosctl --nodes 192.168.0.11 dashboard
```

### ArgoCD Access

- **URL**: https://argocd.themainfreak.com (192.168.0.224)
- **Username**: admin
- **Password**: Zuwp86BXP55U3Zff

### Node Information

| Node | Role | IP | Resources | VM ID | Proxmox Host |
|------|------|-----|-----------|-------|--------------|
| metal0 | Control Plane | 192.168.0.11 | 4 CPU, 44GB RAM | 106 | mirkwood |
| metal1 | Control Plane | 192.168.0.12 | 4 CPU, 27GB RAM | 107 | rohan |
| metal2 | Control Plane | 192.168.0.13 | 4 CPU, 27GB RAM | 104 | gondor |

---

## ✅ Issues Resolved

### 1. API Server Certificate Missing Service CIDR IP

**Issue**: CoreDNS and ArgoCD couldn't connect to Kubernetes API server
**Error**: `tls: failed to verify certificate: x509: certificate is valid for 10.96.0.1, ..., not 10.43.0.1`
**Root Cause**: API server certificate was missing `10.43.0.1` (Kubernetes service IP in our custom service CIDR) from its SANs list

**Resolution**:
1. Patched Talos machine config to include `10.43.0.1` in API server certSANs
2. Rebooted all control plane nodes to regenerate certificates
3. Enabled scheduling on control planes (no worker node deployed yet)
4. Verified certificate now includes all required IPs

**Status**: ✅ **RESOLVED** - ArgoCD fully operational, applications deploying automatically

### 2. No Worker Nodes - Control Plane Scheduling

**Issue**: No worker nodes deployed, pods couldn't schedule due to control plane taints
**Resolution**: Enabled `allowSchedulingOnControlPlanes: true` in Talos config
**Note**: For homelab use, running workloads on control planes is acceptable. Add rivendell (metal3) worker node later if needed for isolation.

---

## 📋 Redeploy from Scratch

The entire cluster can be redeployed with a single command:

```bash
cd /workspaces/portkey
make                    # metal → bootstrap → external
make post-install       # after apps are running: Kanidm OAuth
```

Or step by step:

```bash
make metal              # 1. Talos cluster + Cilium + CRDs
make bootstrap          # 2. Ceph secrets + GitHub creds + ArgoCD + root ApplicationSet
make external           # 3. Terraform: Cloudflare, ZeroTier, ntfy, Vaultwarden
make post-install       # 4. Kanidm OAuth setup (needs running pods)
```

See [metal/README.md](metal/README.md) for detailed per-step instructions.

---

## 🛠️ Troubleshooting Quick Reference

### Cluster Health

```bash
# Check nodes
kubectl get nodes

# Check all pods
kubectl get pods -A | grep -v Running

# Talos health check
talosctl --nodes 192.168.0.11 health
```

### Networking Issues

```bash
# Check Cilium status
kubectl exec -n kube-system cilium-XXXXX -- cilium status

# Check LoadBalancer IP
kubectl get svc -n ingress-nginx

# Test ingress
curl -k https://192.168.0.224
```

### Storage Issues

```bash
# Check storage classes
kubectl get storageclass

# Check CSI drivers
kubectl get pods -n kube-system | grep csi
kubectl get pods -n rook-ceph

# Test PVC
kubectl get pvc -A
```

### ArgoCD Issues

```bash
# Check ArgoCD pods
kubectl get pods -n argocd

# Check ApplicationSet status
kubectl get applicationset -n argocd
kubectl describe applicationset bootstrap -n argocd

# Restart ArgoCD components
kubectl rollout restart deployment/argocd-server -n argocd
```

---

## 📚 Key Documentation Files

| File | Purpose |
|------|---------|
| [CLUSTER.md](CLUSTER.md) | Cluster architecture and overview |
| [metal/README.md](metal/README.md) | Deployment workflow, playbooks, and bootstrap instructions |
| [docs/post-migration-audit.md](docs/post-migration-audit.md) | Post-migration audit and config fixes |
| [docs/opnsense-dns-setup.md](docs/opnsense-dns-setup.md) | Local DNS configuration |
| [bootstrap/deploy.yml](bootstrap/deploy.yml) | Ansible playbook: secrets + ArgoCD bootstrap |
| [bootstrap/vault.yml](bootstrap/vault.yml) | Encrypted Ceph + GitHub credentials |

---

## 🎯 Success Criteria

| Criteria | Status | Notes |
|----------|--------|-------|
| Talos cluster running | ✅ | All 3 nodes healthy |
| Cilium CNI working | ✅ | Pods communicating |
| LoadBalancer functional | ✅ | 192.168.0.224 active |
| Storage classes available | ✅ | ceph-rbd, cephfs, nfs-csi |
| ArgoCD accessible | ✅ | UI and API working |
| Ingress controller working | ✅ | NGINX responding |
| Documentation complete | ✅ | All guides written |
| Automation reproducible | ✅ | `make` deploys everything |
| Secrets in vault | ✅ | Ceph + GitHub in Ansible Vault |
| One-step redeploy | ✅ | `make` from repo root |

---

## 🔄 Rollback Plan (If Needed)

### Emergency: Restore K3s Cluster

If critical issues arise:

1. **Stop Talos VMs**
   ```bash
   for vm in 106 107 104; do
     ssh root@proxmox "qm stop $vm"
   done
   ```

2. **Reattach K3s Disks**
   - In Proxmox UI, for each VM:
   - Hardware → Detach current disk (scsi0)
   - Hardware → unused0 → Edit → Reattach as scsi0
   - Start VM

3. **Verify K3s Cluster**
   ```bash
   kubectl --kubeconfig /workspaces/portkey/metal/kubeconfig-k3s-backup.yaml get nodes
   ```

**Note**: K3s disks preserved as `unused0` on each VM for this purpose.

---

## 📊 Resource Summary

### Commits
- 2 major commits with 43 files changed
- 4,349 insertions total
- Complete feature set documented

### Infrastructure Components
- 3 Talos nodes
- 1 Cilium CNI
- 1 NGINX Ingress
- 3 Storage classes
- 1 ArgoCD instance
- 20+ Ansible playbooks

### Time Invested
- Migration planning: ~1 hour
- Cluster deployment: ~2 hours
- Troubleshooting: ~1 hour
- Documentation: ~1 hour
- **Total**: ~5 hours

---

## 🙏 Acknowledgments

This migration successfully transitioned the Portkey cluster from K3s on Fedora 39 to Talos Linux, establishing a modern, immutable, API-driven Kubernetes platform ready for production workloads.

**Key Achievement**: Zero data loss, all infrastructure preserved and enhanced, complete automation and documentation for future operations.

---

**Status**: 🟢 Fully Operational
**Last Updated**: 2026-02-09
**Migration Phase**: Complete — One-step redeploy via `make`
