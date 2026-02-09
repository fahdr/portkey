# Post-Migration Audit (2026-02-09)

Audit of the live Talos cluster vs git repo performed after the K3s to Talos migration. Many changes were made on the fly during migration and the repo files had drifted from the actual cluster state.

## Findings and Fixes

### 1. Talos Config Patches Were Broken

The playbook patches at `metal/playbooks/talos-configs/patches/` had 4 critical errors that would have broken a fresh deploy:

| Issue | Before (broken) | After (matches live) |
|-------|-----------------|---------------------|
| API version deadlock | `runtime-config: v1alpha1` | `runtime-config: v1beta1` |
| No pod scheduling | `allowSchedulingOnControlPlanes: false` | `true` |
| Wrong NIC name | `interface: eth0` | `interface: ens18` |
| VIP on 1/3 nodes | VIP only on metal2 | VIP on all 3 nodes |
| Missing GPU driver | No kernel modules | `kernel.modules: [{name: i915}]` |
| Stale hostnames | `hostname: metal0/1/2` | Removed (Talos auto-stable) |

The `runtime-config: v1alpha1` bug is particularly dangerous -- it causes the API server to deadlock on startup in Kubernetes v1.34+, since `MutatingAdmissionPolicy` graduated to v1beta1.

**Files changed:**
- `metal/playbooks/talos-configs/patches/common.yaml`
- `metal/playbooks/talos-configs/patches/controlplane.yaml`
- `metal/playbooks/talos-configs/patches/metal0.yaml`
- `metal/playbooks/talos-configs/patches/metal1.yaml`
- `metal/playbooks/talos-configs/patches/metal2.yaml`

The `.gitignore` was also updated so these patches are now tracked in git (they contain no secrets -- only network and API server config).

### 2. Cilium Config Drift

There were 3 competing Cilium config sources in the repo, each with different values. Only `talos-install-cilium.yml` matched the live cluster.

| Setting | Live | install-cilium.yml | deploy-cilium.yml (was wrong) | bootstrap defaults (was wrong) |
|---------|------|-------------------|-------------------------------|-------------------------------|
| `k8sServiceHost` | 192.168.0.100 | 192.168.0.100 | **missing** | **missing** |
| `k8sServicePort` | 6443 | 6443 | **missing** | **missing** |
| Hubble | disabled | disabled | **enabled** | **enabled** |
| Tolerations | 3 entries | 3 entries | **missing** | **missing** |
| LB IP Pool | 192.168.0.224/27 | N/A | N/A | **192.168.0.160/27** (stale migration pool) |

Without `k8sServiceHost` and `tolerations`, Cilium cannot bootstrap on Talos (no API server discovery, can't schedule on control plane nodes).

**Files changed:**
- `metal/playbooks/talos-deploy-cilium.yml` -- added k8sServiceHost, tolerations, disabled hubble
- `metal/roles/talos_bootstrap/defaults/main.yml` -- same fixes + updated LB pool to production

### 3. Stale ArgoCD ApplicationSet

A stale `root` ApplicationSet existed alongside the per-stack ApplicationSets (`system`, `platform`, `apps`, `sites`). It was left over from the initial bootstrap and caused constant ownership conflict errors:

```
Object argocd/actions-runner-controller is already owned by another ApplicationSet controller system
```

**Fix:** Deleted via `kubectl delete applicationset root -n argocd`

### 4. Directory Name Collisions

Two directory names existed in multiple stacks, causing ApplicationSet collisions:

| Name | Locations | Resolution |
|------|-----------|------------|
| `argocd` | `bootstrap/argocd/` + `system/argocd/` | Deleted `system/argocd/`, merged homepage annotations into `bootstrap/argocd/values.yaml` |
| `kured` | `system/kured/` + `platform/kured/` | Deleted `platform/kured/`, merged PodSecurity namespace labels into `system/kured/templates/namespace.yaml` |

Also deleted empty `system/argocd-dev/` directory.

### 5. Dead Values in bootstrap/argocd

`bootstrap/argocd/values.yaml` had an `argocd-apps:` section referencing a chart dependency that wasn't in its `Chart.yaml`. This was the old approach before `bootstrap/root/templates/stack.yaml` replaced it. Removed the dead section.

### 6. Orphan Namespaces and Resources

| Resource | Type | Action |
|----------|------|--------|
| `test-api` namespace | Empty, manually created | Deleted |
| `volsync-system` namespace | Empty, stale from initial install | Deleted |
| `k8up-operator` namespace | Empty, k8up not used | Deleted |
| `volsync` deployment in `default` ns | Stale from initial install | Deleted |

Also removed `k8up-operator` from `external/namespaces.yml`.

### 7. Stale CRD Version

`metal/playbooks/talos-install-crds.yml` referenced cert-manager v1.16.3 CRDs but the cluster runs v1.19.3. Updated to match.

### 8. Kured Reboot Sentinel Not Working on Talos

The kured values had `rebootSentinelCommand: sh -c "! needs-restarting --reboothint"` from the k3s/Fedora era. This was silently ignored because the chart defaults `useRebootSentinelHostPath: true`, and the chart template only renders `rebootSentinelCommand` when `useRebootSentinelHostPath` is false. Furthermore, `needs-restarting` doesn't exist on Talos Linux.

**Fix:** Removed the dead command, explicitly set `useRebootSentinelHostPath: true` with sentinel file `/var/run/reboot-required`. Kured will reboot a node when that file is created (e.g., manually or by an upgrade script).

**File changed:** `system/kured/values.yaml`

### 9. Stale Helm Releases Cleaned Up

Two orphan Helm release records existed from manual installs that preceded ArgoCD:

| Release | Namespace | Status | Chart | Action |
|---------|-----------|--------|-------|--------|
| `rook-ceph-operator` | rook-ceph | deployed | rook-ceph-v1.17.2 | Uninstalled (ArgoCD manages v1.19.1) |
| `monitoring-system` | monitoring-system | failed | kube-prometheus-stack-0.0.0 | Uninstalled (ArgoCD re-synced all resources) |

Only `cilium` remains as a Helm release (installed before ArgoCD, by design).

### 10. Helm Template Dry Run Verification

All 40 charts across system/, platform/, apps/, and sites/ were template-rendered and compared against live cluster state:

- **Render failures:** 0 (after dependency updates)
- **Resource type mismatches:** 0
- **Image version mismatches:** 0
- **All charts match live state**

### 11. Deployment Pipeline Rewrite

All Makefiles and bootstrap scripts were rewritten for Talos. The old k3s-era shell scripts were replaced with Ansible playbooks.

**Before (broken):**
- Root Makefile: `system → external → smoke-test → clean` (k3s targets, PXE server teardown)
- metal/Makefile: PXE boot + k3s cluster creation
- bootstrap/: Shell scripts (`apply.sh`, `apply-github-secret.sh`) + `.cephrc` with raw Ceph keys in git
- bootstrap/root/apply.sh: Downloaded ancient rook v1.10 import script from internet
- system/Makefile + system/bootstrap.yml: Stale duplicate of bootstrap/

**After (working):**
- Root Makefile: `metal → bootstrap → external` (correct Talos ordering)
- metal/Makefile: `apply-configs → talosctl bootstrap → post-bootstrap`
- bootstrap/deploy.yml: Ansible playbook creates Ceph secrets + GitHub creds + ArgoCD + root ApplicationSet
- bootstrap/vault.yml: Ansible Vault encrypted credentials (Ceph keys + GitHub token)
- Terraform manages external secrets (Cloudflare, ZeroTier, ntfy, Vaultwarden)

**Files changed:**
| File | Action |
|------|--------|
| `Makefile` | Rewritten (Talos ordering) |
| `metal/Makefile` | Rewritten (Talos playbooks) |
| `bootstrap/Makefile` | Rewritten (calls Ansible) |
| `bootstrap/deploy.yml` | Created (main Ansible bootstrap playbook) |
| `bootstrap/vault.yml` | Created (encrypted Ceph + GitHub credentials) |
| `external/Makefile` | Fixed (added KUBECONFIG, fixed hardcoded editor) |

**Files deleted:**
| File | Reason |
|------|--------|
| `bootstrap/argocd/apply.sh` | Replaced by deploy.yml |
| `bootstrap/argocd/apply-github-secret.sh` | Replaced by deploy.yml |
| `bootstrap/root/apply.sh` | Replaced by deploy.yml (removed ancient rook v1.10 download) |
| `bootstrap/root/.cephrc` | Raw Ceph keys moved to Ansible Vault |
| `bootstrap/main.yml` | Just a TODO comment |
| `bootstrap/argocd/githubsecret.env` | Token moved to Ansible Vault |
| `system/Makefile` | Stale, ArgoCD manages system/ charts |
| `system/bootstrap.yml` | Overlapped with bootstrap/ |
| `system/argocd-manifests.yaml` | 1.9MB generated file |

## Items Not Changed (For Awareness)

- **rook-ceph Degraded health**: CephCluster reports `HEALTH_WARN` (15 OSDs with slow BlueStore ops). This is a Proxmox Ceph infrastructure issue, not a Kubernetes config problem.
- **Hubble**: Intentionally disabled in live cluster. All repo configs updated to match.

## Summary of All Changes

### Files Modified
| File | Change |
|------|--------|
| `.gitignore` | Made talos-configs ignore specific; patches now tracked; added .cephrc |
| `Makefile` | Rewritten: metal → bootstrap → external (was k3s-era) |
| `metal/Makefile` | Rewritten: Talos playbooks (was PXE boot + k3s) |
| `bootstrap/Makefile` | Rewritten: calls Ansible deploy.yml (was shell scripts) |
| `bootstrap/argocd/values.yaml` | Merged homepage annotations, explicit TLS, removed dead argocd-apps section |
| `external/Makefile` | Added KUBECONFIG export, fixed hardcoded nvim editor |
| `external/namespaces.yml` | Removed k8up-operator |
| `metal/README.md` | Rewrote bootstrap steps and one-liner for Make targets |
| `metal/playbooks/talos-deploy-cilium.yml` | Added k8sServiceHost/Port, tolerations, hubble=false |
| `metal/playbooks/talos-install-crds.yml` | cert-manager CRD v1.16.3 -> v1.19.3 |
| `metal/playbooks/talos-post-bootstrap.yml` | Updated next steps to reference Make targets |
| `metal/roles/talos_bootstrap/defaults/main.yml` | Fixed LB pool, added k8sServiceHost/Port, tolerations, hubble=false |
| `system/kured/values.yaml` | Removed dead k3s sentinel command, set Talos-compatible sentinel file |
| `MIGRATION-COMPLETE.md` | Updated deployment pipeline, docs table, success criteria |
| `CLUSTER.md` | Updated recovery procedure to reference Make |
| `metal/TALOS-DEPLOYMENT.md` | Replaced apply.sh references with Make targets |

### Files Added
| File | Content |
|------|---------|
| `bootstrap/deploy.yml` | Ansible playbook: Ceph secrets + GitHub creds + ArgoCD + root ApplicationSet |
| `bootstrap/vault.yml` | Ansible Vault encrypted Ceph + GitHub credentials |
| `system/kured/templates/namespace.yaml` | PodSecurity privileged labels (from platform/kured) |
| `metal/playbooks/talos-configs/patches/common.yaml` | Fixed runtime-config, added i915 |
| `metal/playbooks/talos-configs/patches/controlplane.yaml` | Fixed allowSchedulingOnControlPlanes |
| `metal/playbooks/talos-configs/patches/metal{0,1,2}.yaml` | Fixed interface, added VIP to all nodes |

### Files Deleted
| File | Reason |
|------|--------|
| `bootstrap/argocd/apply.sh` | Replaced by bootstrap/deploy.yml |
| `bootstrap/argocd/apply-github-secret.sh` | Replaced by bootstrap/deploy.yml |
| `bootstrap/root/apply.sh` | Replaced by bootstrap/deploy.yml (removed rook v1.10 download) |
| `bootstrap/root/.cephrc` | Raw Ceph keys moved to Ansible Vault |
| `bootstrap/main.yml` | Just a TODO comment |
| `bootstrap/argocd/githubsecret.env` | Token moved to Ansible Vault |
| `system/Makefile` | Stale, ArgoCD manages system/ charts |
| `system/bootstrap.yml` | Overlapped with bootstrap/ |
| `system/argocd-manifests.yaml` | 1.9MB generated file |
| `system/argocd/` (4 files) | Name collision with bootstrap/argocd |
| `system/argocd-dev/` | Empty directory |
| `platform/kured/templates/namespace.yaml` | Name collision with system/kured |

### Cluster Cleanup
| Action | Resource |
|--------|----------|
| Deleted ApplicationSet | `root` (stale, ownership conflicts) |
| Deleted namespace | `test-api`, `volsync-system`, `k8up-operator` |
| Deleted deployment | `volsync` in default namespace |
| Uninstalled helm release | `rook-ceph-operator` v1.17.2 (stale, ArgoCD manages v1.19.1) |
| Uninstalled helm release | `monitoring-system` (failed, ArgoCD re-synced all resources) |
