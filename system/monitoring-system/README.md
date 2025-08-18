# Infrastructure Monitoring Setup

This monitoring configuration extends the existing Kubernetes monitoring to include external infrastructure components.

## Monitored Components

### 1. Proxmox VE Cluster (6 Nodes)
- **Nodes**: proxmox-01 through proxmox-06
- **Endpoints**: Each node at `:8006` for API metrics, `:9100` for node exporter
- **Metrics**: Cluster status, individual node CPU/memory/storage, VM statistics
- **Authentication**: Basic auth with dedicated monitoring user
- **Dashboard**: Proxmox VE Cluster Overview

### 2. ZFS Storage System
- **Host**: proxmox-06 (or whichever node hosts ZFS)
- **NFS Export**: LXC container at 192.168.0.41
- **Metrics**: ZFS pool health, usage, performance, NFS export statistics
- **Includes**: Pool status, dataset usage, scrub status, ARC statistics
- **Dashboard**: ZFS and NFS Storage

### 3. NFS LXC Container (192.168.0.41)
- **Purpose**: Exports ZFS datasets via NFS
- **Metrics**: Container resources, NFS connection count, export activity
- **Monitoring**: Node exporter + NFS exporter for detailed statistics
- **Parent**: Runs on one of the Proxmox nodes with ZFS pools

### 4. AdGuard Home
- **Endpoint**: `adguard.local` (update as needed)
- **Metrics**: DNS query statistics, blocked queries, client stats
- **Authentication**: Basic auth with AdGuard credentials

### 5. SNMP Devices
- **Targets**: Router, NFS server, network equipment
- **Metrics**: Interface statistics, system uptime, storage usage
- **Exporter**: Prometheus SNMP Exporter deployed in cluster

## Prerequisites

### Proxmox VE Cluster Setup
1. Create a monitoring user in Proxmox (on any node, it will replicate):
   ```bash
   # On any Proxmox node
   pveum user add monitoring@pve
   pveum passwd monitoring@pve
   pveum role add PVEAuditor
   pveum acl modify / -user monitoring@pve -role PVEAuditor
   ```

2. Enable Prometheus metrics endpoint on all nodes:
   ```bash
   # On each Proxmox node, add to /etc/pve/status.cfg
   prometheus: server=0.0.0.0:9273
   ```

3. Install Node Exporter on all nodes (optional but recommended):
   ```bash
   # On each Proxmox node
   wget https://github.com/prometheus/node_exporter/releases/download/v1.6.1/node_exporter-1.6.1.linux-amd64.tar.gz
   tar xzf node_exporter-1.6.1.linux-amd64.tar.gz
   cp node_exporter-1.6.1.linux-amd64/node_exporter /usr/local/bin/
   
   # Create systemd service
   cat > /etc/systemd/system/node_exporter.service << EOF
   [Unit]
   Description=Node Exporter
   
   [Service]
   ExecStart=/usr/local/bin/node_exporter
   Restart=always
   User=nobody
   
   [Install]
   WantedBy=multi-user.target
   EOF
   
   systemctl enable --now node_exporter
   ```

### ZFS and NFS Setup
1. Install ZFS exporter on the ZFS host node (proxmox-06):
   ```bash
   # On the Proxmox node with ZFS pools
   wget https://github.com/pdf/zfs_exporter/releases/download/v2.2.5/zfs_exporter-2.2.5.linux-amd64.tar.gz
   tar xzf zfs_exporter-2.2.5.linux-amd64.tar.gz
   cp zfs_exporter-2.2.5.linux-amd64/zfs_exporter /usr/local/bin/
   
   # Create systemd service
   cat > /etc/systemd/system/zfs_exporter.service << EOF
   [Unit]
   Description=ZFS Exporter
   
   [Service]
   ExecStart=/usr/local/bin/zfs_exporter
   Restart=always
   User=root
   
   [Install]
   WantedBy=multi-user.target
   EOF
   
   systemctl enable --now zfs_exporter
   ```

2. Install NFS exporter in the LXC container (192.168.0.41):
   ```bash
   # Inside the NFS LXC container
   wget https://github.com/DanielHeath/nfs_exporter/releases/download/0.2.0/nfs_exporter-0.2.0-linux-amd64.tar.gz
   tar xzf nfs_exporter-0.2.0-linux-amd64.tar.gz
   cp nfs_exporter /usr/local/bin/
   
   # Create systemd service
   cat > /etc/systemd/system/nfs_exporter.service << EOF
   [Unit]
   Description=NFS Exporter
   
   [Service]
   ExecStart=/usr/local/bin/nfs_exporter
   Restart=always
   
   [Install]
   WantedBy=multi-user.target
   EOF
   
   systemctl enable --now nfs_exporter
   ```

### NFS LXC Container Setup
1. Install Node Exporter in the container:
   ```bash
   # Same node exporter installation as above
   wget https://github.com/prometheus/node_exporter/releases/download/v1.6.1/node_exporter-1.6.1.linux-amd64.tar.gz
   # ... (same installation steps)
   ```

### OpnSense Setup
1. Enable SNMP service:
   - Go to Services → SNMP
   - Enable SNMP, set community to 'public' (or configure auth)
   - Allow monitoring from Kubernetes cluster IPs

2. API access (optional):
   - Go to System → Access → Users
   - Create monitoring user with API privileges
   - Generate API key

### NFS Server Setup
1. Install Node Exporter:
   ```bash
   # On NFS server (Ubuntu/Debian)
   wget https://github.com/prometheus/node_exporter/releases/download/v1.6.1/node_exporter-1.6.1.linux-amd64.tar.gz
   tar xzf node_exporter-1.6.1.linux-amd64.tar.gz
   sudo cp node_exporter-1.6.1.linux-amd64/node_exporter /usr/local/bin/
   
   # Create systemd service
   sudo tee /etc/systemd/system/node_exporter.service > /dev/null <<EOF
   [Unit]
   Description=Node Exporter
   
   [Service]
   ExecStart=/usr/local/bin/node_exporter
   Restart=always
   
   [Install]
   WantedBy=multi-user.target
   EOF
   
   sudo systemctl enable --now node_exporter
   ```

2. Configure SNMP (if not already enabled):
   ```bash
   sudo apt install snmpd
   sudo systemctl enable --now snmpd
   ```

### AdGuard Home Setup
1. Enable statistics API access
2. Create monitoring user with read-only permissions
3. Configure API authentication

## Security Configuration

Update the following secrets with actual credentials:

```bash
# Proxmox credentials
kubectl patch secret proxmox-credentials -n monitoring-system \
  --patch='{"stringData":{"username":"monitoring@pve","password":"YOUR_PROXMOX_PASSWORD"}}'

# OpnSense credentials (if using API)
kubectl patch secret opnsense-credentials -n monitoring-system \
  --patch='{"stringData":{"username":"monitoring","password":"YOUR_OPNSENSE_PASSWORD"}}'

# AdGuard credentials
kubectl patch secret adguard-credentials -n monitoring-system \
  --patch='{"stringData":{"username":"admin","password":"YOUR_ADGUARD_PASSWORD"}}'
```

## Grafana Dashboards

The following dashboards are automatically provisioned:

1. **Proxmox VE Cluster Overview**
   - 6-node cluster status and health
   - Per-node CPU, memory, and storage usage
   - VM/Container distribution across nodes
   - Cluster-wide resource utilization

2. **ZFS and NFS Storage**
   - ZFS pool health and usage statistics
   - NFS export activity and client connections
   - LXC container resource usage
   - Storage performance metrics

3. **Network Infrastructure**
   - Router interface traffic
   - System uptime
   - SNMP device metrics
   - Network device health

## Monitoring Endpoints

- Prometheus scrapes the following external endpoints:
  - `proxmox-01:8006/api2/prometheus` through `proxmox-06:8006/api2/prometheus` (Proxmox cluster metrics)
  - `proxmox-01:9100/metrics` through `proxmox-06:9100/metrics` (Node exporter per node)
  - `proxmox-06:9134/metrics` (ZFS exporter on ZFS host node)
  - `192.168.0.41:9100/metrics` (NFS LXC container node exporter)
  - `192.168.0.41:9172/metrics` (NFS exporter in LXC container)
  - `snmp-exporter:9116/snmp` (All SNMP devices via exporter)
  - `adguard.local/control/stats` (AdGuard statistics)

## Troubleshooting

### Check ServiceMonitor status:
```bash
kubectl get servicemonitors -n monitoring-system
kubectl describe servicemonitor proxmox-nodes -n monitoring-system
```

### Verify Prometheus targets:
- Go to Grafana → Prometheus → Targets
- Check if external endpoints are UP and scraping

### Test connectivity:
```bash
# From a pod in the cluster
kubectl run -it --rm debug --image=nicolaka/netshoot --restart=Never
# Inside the pod:
curl -k https://proxmox:8006/api2/prometheus
telnet 192.168.0.41 9100
```

## Customization

- Update IP addresses in ServiceMonitor configurations
- Modify scrape intervals based on your needs
- Add additional SNMP devices to the snmp-exporter configuration
- Create custom dashboards for specific infrastructure components
