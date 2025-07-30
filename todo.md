# Roadmap
1. ✅ Add auto service discovery for Homepage
2. Add proxmox nodes, opnsense, proxmox-ceph, Adguard ZFS and others to prometheus and grafana instance running in the kubernetes cluster
3. Fix zerotier to access ips outside of kubernetes ips (192.168.0.0)
4. Try to make the secret-generator an operator so that the applications can directly request for a secret to be generated from within the application definition and/or helm configuration
5. ??

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