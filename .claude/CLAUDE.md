I have a 6 node proxmox cluster. 3 nodes are running vms that run kubernetes. Each node has an nvme that is running ceph. The kubernetes cluster has rook with external cluster configuration. One of my proxmox nodes has 8 disks configured with zfs. This is shared as nfs and samba using an lxc container with the zfs folder mounted and run using turnkey file share container with webmin installed. This proxmox node also has opnsense running as a vm. Opnsense has adguard installed as a plugin.

shire - 192.168.0.2, rivendell - 192.168.0.202, isengard - 192.168.0.102,mirkwood - 192.168.0.8, rohan -192.168.0.7, gondor - 192.168.0.6

My networking goes like this:
- wan connected to opnsense vm via proxmox bridge vmbr0
- opnsense vm has 2 interfaces, one for wan (vmbr0) and one for lan (vmbr1)
- lan interface (vmbr1) is connected to a switch that connects to all other proxmox nodes and my home devices, wireless router running in ap mode only using openwrt firmware

## Kubernetes Cluster

- **OS**: Talos Linux v1.12.3, Kubernetes v1.35.0
- **CNI**: Cilium (kubeProxyReplacement, L2 announcements, Hubble enabled)
- **Nodes**: 3 control plane nodes (.11, .12, .13) with `allowSchedulingOnControlPlanes: true`
  - .11 and .12 have Intel iGPU (gpu.intel.com/i915), .13 does not
- **Network CIDRs**: `serviceSubnets: 10.43.0.0/16`, `podSubnets: 10.0.1.0/8`
- **VIP**: 192.168.0.100 (configured on all control plane nodes)
- **KubePrism**: local LB on port 7445

## Storage
- **Ceph**: External Proxmox-managed cluster via Rook, RBD + CephFS
- **NFS**: NFS CSI driver for shared ZFS storage from shire

## Monitoring
- **kube-prometheus-stack**: Prometheus, Alertmanager (ntfy relay), Grafana
- **Control plane monitoring**: kubeControllerManager, kubeScheduler, kubeEtcd with bind-address 0.0.0.0
- **metrics-server**: Deployed for `kubectl top` support (--kubelet-insecure-tls)
- **Hubble**: Cilium network observability at hubble.themainfreak.com
- **Infrastructure exporters**: Proxmox, OPNsense, AdGuard, Ceph, node-exporter on Proxmox hosts

## GitOps
- **ArgoCD**: ApplicationSets with git directory generator
- **Sync options**: `CreateNamespace=true`, `ApplyOutOfSyncOnly=true`, `ServerSideApply=true`
- **No `Replace=true`**: Removed to prevent CRD/hook conflicts

## Intel GPU
- **Shared GPU**: `sharedDevNum: 10` allows up to 10 pods to share each iGPU
- **Workloads**: jellyfin, ollama use gpu.intel.com/i915