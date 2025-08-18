# Roadmap
1. ✅ Add auto service discovery for Homepage
2. ✅ Add proxmox nodes, opnsense, proxmox-ceph, Adguard ZFS and others to prometheus and grafana instance running in the kubernetes cluster
3. Fix zerotier to access ips outside of kubernetes ips (192.168.0.0)
4. Try to make the secret-generator an operator so that the applications can directly request for a secret to be generated from within the application definition and/or helm configuration
5. precommit hooks to check helm chart configuration

## Completed: Homepage Auto Service Discovery

### What was implemented:
- **Kubernetes integration**: Added Kubernetes configuration (`kubernetes.yaml`) to enable cluster mode and ingress discovery
- **RBAC setup**: Created proper service account, ClusterRole, and ClusterRoleBinding for Homepage to read ingresses and pods
- **Auto-discovery annotations**: Added `gethomepage.dev/*` annotations to ingresses across multiple applications:
  - **Popular Services**: Jellyfin, Jellyseerr, Matrix, Paperless, Navidrome
  - **Management**: Transmission, Prowlarr, Radarr, Sonarr, Kanidm
  - **Development**: ArgoCD, Grafana, Registry (Zot), Ollama, AI Chat
  - **Utilities**: Excalidraw, Speedtest, Vaultwarden, Nextcloud, Budget (ActualBudget), Grocy

### Benefits:
- Services automatically appear on Homepage when deployed
- No more manual maintenance of services list in Homepage configuration
- Consistent grouping and metadata across all services
- Widget integration for supported services (Jellyfin, Sonarr, Radarr, etc.)

### How it works:
Homepage now scans Kubernetes ingresses looking for `gethomepage.dev/enabled: "true"` annotations and automatically adds them to the dashboard with their configured name, description, group, and icon.

## Completed: Infrastructure Monitoring Setup

### What was implemented:
- **External monitoring**: Extended Prometheus to monitor infrastructure outside Kubernetes cluster
- **Proxmox VE monitoring**: ServiceMonitor for Proxmox nodes with metrics scraping from API endpoint
- **Network monitoring**: OpnSense router monitoring via SNMP and HTTP API
- **NFS server monitoring**: Node exporter and SNMP monitoring for storage server (192.168.0.41)
- **AdGuard monitoring**: DNS service monitoring with query statistics
- **SNMP exporter**: Deployed SNMP exporter for network device monitoring
- **Grafana dashboards**: Auto-provisioned dashboards for Proxmox overview and network infrastructure

### Infrastructure monitored:
- **Proxmox nodes**: CPU, memory, storage, VM statistics
- **OpnSense router**: Interface traffic, system status, firewall metrics  
- **NFS/ZFS server**: System metrics, storage utilization, network stats
- **AdGuard Home**: DNS query stats, blocked queries, client metrics
- **SNMP devices**: General network equipment monitoring

### Benefits:
- Centralized monitoring of entire infrastructure stack
- Historical metrics and alerting for critical infrastructure
- Unified dashboards combining Kubernetes and external systems
- Automated discovery and monitoring of network devices 