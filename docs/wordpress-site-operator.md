# WordPress Site Operator Documentation

## Overview

The WordPress Site Operator is a Helm-based deployment system for spinning up WordPress/WooCommerce sites on Kubernetes. Each site gets its own MariaDB instance with replication support and VolSync backups.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Site Chart (e.g., case10)                      │
├─────────────────────────────────────────────────────────────────────────┤
│  Chart.yaml          → Depends on wordpress-site                        │
│  values.yaml         → Site-specific configuration                      │
│  templates/          → Site-specific resources (ExternalSecrets, etc.)  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       wordpress-site (Bootstrap Chart)                   │
├─────────────────────────────────────────────────────────────────────────┤
│  Coordinates deployment of:                                              │
│    ├── mariadb chart    → MariaDB Operator CRDs                         │
│    └── wordpress chart  → Deployment, Services, Ingress, HPA            │
└─────────────────────────────────────────────────────────────────────────┘
                          │                    │
                          ▼                    ▼
┌────────────────────────────────┐  ┌────────────────────────────────────┐
│        MariaDB Chart           │  │         WordPress Chart            │
├────────────────────────────────┤  ├────────────────────────────────────┤
│ • MariaDB CRD (cluster)        │  │ • Deployment (PHP-FPM + Nginx)     │
│ • Database CRD                 │  │ • Service                          │
│ • User CRD                     │  │ • Ingress (with TLS)               │
│ • Grant CRD                    │  │ • HPA                              │
│ • Backup/Restore CRDs          │  │ • PVC for wp-content               │
│ • Secret (if not external)     │  │ • ConfigMaps                       │
└────────────────────────────────┘  │ • Secret (if not external)         │
                                    └────────────────────────────────────┘
```

### Components

| Component | Description | Chart Location |
|-----------|-------------|----------------|
| MariaDB Operator | Manages MariaDB clusters | `sites/mariadb-operator/` |
| MariaDB Chart | Per-site database configuration | `charts-common/common/mariadb/` |
| WordPress Chart | WordPress deployment | `charts-common/common/wordpress/` |
| WordPress-Site | Bootstrap/coordinator chart | `charts-common/bootstrap/wordpress-site/` |

---

## Prerequisites

1. **MariaDB Operator** must be installed in the cluster:
   ```bash
   helm install mariadb-operator sites/mariadb-operator/
   ```

2. **External Secrets Operator** (optional, for Vaultwarden integration):
   ```bash
   helm install external-secrets external-secrets/external-secrets
   ```

3. **ClusterSecretStore** configured for Vaultwarden (if using External Secrets):
   ```yaml
   apiVersion: external-secrets.io/v1beta1
   kind: ClusterSecretStore
   metadata:
     name: vaultwarden-fields
   spec:
     provider:
       # Your Vaultwarden configuration
   ```

4. **Ingress Controller** (nginx-ingress recommended)

5. **cert-manager** (for automatic TLS certificates)

---

## Deploying a New WordPress Site

### Step 1: Create Site Directory

```bash
mkdir -p sites/mysite/templates
```

### Step 2: Create Chart.yaml

```yaml
# sites/mysite/Chart.yaml
apiVersion: v2
name: mysite
version: 0.1.0
dependencies:
  - name: wordpress-site
    repository: https://fahdr.github.io/portkey/
    version: 0.1.25  # Use latest version
```

### Step 3: Create values.yaml

```yaml
# sites/mysite/values.yaml
wordpress-site:
  # --- MariaDB Configuration ---
  mariadb:
    mariadb:  # Note: nested under mariadb.mariadb
      replicas: 3
      storage:
        size: 5Gi
        # storageClassName: ceph-block  # Optional
      replication:
        enabled: true
      externalSecret:
        enabled: true  # Use External Secrets (recommended)
      resources:
        requests:
          cpu: 100m
          memory: 512Mi
        limits:
          cpu: 500m
          memory: 1Gi

  # --- WordPress Configuration ---
  wordpress:
    wordpress:  # Note: nested under wordpress.wordpress
      db:
        secretKeyRefName: mysite-mariadb-secrets
        secretKeyRefKey: "MARIADB_PASSWORD"
      ingress:
        host: mysite.example.com
      externalSecret:
        enabled: false  # Use Helm lookup for WordPress secrets
      resources:
        requests:
          cpu: 100m
          memory: 128Mi
        limits:
          cpu: 500m
          memory: 512Mi
```

### Step 4: Create ExternalSecret (if using Vaultwarden)

```yaml
# sites/mysite/templates/mariadb-external-secret.yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: {{ .Release.Name }}-mariadb-secrets
  namespace: {{ .Release.Namespace }}
spec:
  refreshInterval: 15m
  secretStoreRef:
    name: vaultwarden-fields
    kind: ClusterSecretStore
  target:
    name: {{ .Release.Name }}-mariadb-secrets
    creationPolicy: Owner
    template:
      metadata:
        labels:
          k8s.mariadb.com/watch: ""  # Required for MariaDB Operator
      type: Opaque
  data:
    - secretKey: MARIADB_PASSWORD
      remoteRef:
        key: mysite-mariadb
        property: user_password
    - secretKey: MARIADB_ROOT_PASSWORD
      remoteRef:
        key: mysite-mariadb
        property: root_password
    - secretKey: MARIADB_REPL_PASSWORD
      remoteRef:
        key: mysite-mariadb
        property: repl_password
    - secretKey: MINIO_ACCESS_KEY
      remoteRef:
        key: mysite-minio
        property: access_key
    - secretKey: MINIO_SECRET_KEY
      remoteRef:
        key: mysite-minio
        property: secret_key
```

### Step 5: Deploy

```bash
cd sites/mysite
helm dependency update
helm install mysite . -n mysite --create-namespace
```

---

## Configuration Reference

### MariaDB Configuration

All MariaDB options go under `wordpress-site.mariadb.mariadb`:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicas` | Number of MariaDB replicas | `3` |
| `user` | Database username | `<release-name>-user` |
| `storage.size` | PVC size for database | `1Gi` |
| `storage.storageClassName` | Storage class | cluster default |
| `replication.enabled` | Enable replication | `true` |
| `externalSecret.enabled` | Use External Secrets | `false` |
| `passwords.user` | User password (if not external) | random 16-char |
| `passwords.root` | Root password (if not external) | random 24-char |
| `passwords.replication` | Replication password | random 16-char |
| `resources.requests.memory` | Memory request | `512Mi` |
| `resources.limits.memory` | Memory limit | `1024Mi` |
| `tls.enabled` | Enable TLS | `false` |

### WordPress Configuration

All WordPress options go under `wordpress-site.wordpress.wordpress`:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `image` | WordPress image | `ghcr.io/fahdr/wordpress:6.8.1-php8.4-fpm` |
| `db.secretKeyRefName` | Secret containing DB password | required |
| `db.secretKeyRefKey` | Key in secret for password | `MARIADB_PASSWORD` |
| `ingress.host` | Site hostname | required |
| `externalSecret.enabled` | Use External Secrets for WP | `false` |
| `resources.requests.memory` | Memory request | `128Mi` |
| `resources.limits.memory` | Memory limit | `256Mi` |
| `healthProbes.enabled` | Enable health probes | `true` |
| `healthProbes.liveness.initialDelaySeconds` | Liveness initial delay | `30` |
| `healthProbes.readiness.initialDelaySeconds` | Readiness initial delay | `10` |
| `storage.wwwdata.size` | PVC size for wp-content | `1Gi` |
| `hpa.maxReplicas` | Max HPA replicas | `10` |
| `hpa.cpuUtilization` | CPU threshold for scaling | `80` |

---

## Secret Management

### Option 1: External Secrets (Recommended for Production)

Secrets are stored in Vaultwarden and synced via External Secrets Operator.

**Pros:**
- Single source of truth
- Survives helm uninstall/reinstall
- No password drift
- Audit trail in Vaultwarden

**Configuration:**
```yaml
wordpress-site:
  mariadb:
    mariadb:
      externalSecret:
        enabled: true
```

**Required Vaultwarden entries:**
- `<site>-mariadb` with fields: `user_password`, `root_password`, `repl_password`
- `<site>-minio` with fields: `access_key`, `secret_key` (for backups)

### Option 2: Helm Lookup (Default)

Secrets are generated on first install and preserved on upgrades using Helm's `lookup` function.

**Pros:**
- Simpler setup
- No external dependencies
- Works out of the box

**Configuration:**
```yaml
wordpress-site:
  mariadb:
    mariadb:
      externalSecret:
        enabled: false
```

**Important:** Secrets have `helm.sh/resource-policy: keep` annotation to prevent deletion on `helm uninstall`.

---

## Known Issues and Fixes

### Issue 1: Password Regeneration on Helm Upgrade

**Symptom:** WordPress/MariaDB pods crash after `helm upgrade` with authentication errors.

**Root Cause:** Helm's `randAlphaNum` generates new passwords on every template render. If secrets don't use `lookup`, passwords change but the database retains old passwords.

**Fix Applied:**
- Added `lookup` function to check for existing secrets before generating
- Added `helm.sh/resource-policy: keep` annotation
- Secrets only generate new values on first install

**Files Changed:**
- `charts-common/common/wordpress/templates/secrets.yaml`
- `charts-common/common/mariadb/templates/secret.yaml`

---

### Issue 2: Bootstrap Script Silent Failure

**Symptom:** WordPress pod starts but can't connect to database; no clear error in logs.

**Root Cause:** Bootstrap script waited 1 minute for database, then continued silently instead of failing.

**Fix Applied:**
- Changed timeout from 1 minute to 5 minutes (60 retries × 5 seconds)
- Added `exit 1` on timeout instead of continuing
- Added progress output showing retry count

**File Changed:** `charts-common/common/wordpress/templates/wp-bootstrap.yaml`

---

### Issue 3: No Health Probes

**Symptom:** Unhealthy pods not detected; stuck pods not restarted.

**Root Cause:** Deployment had no liveness/readiness probes configured.

**Fix Applied:**
- Added TCP liveness probe on port 9000 (PHP-FPM)
- Added TCP readiness probe on port 80 (nginx)
- Made probes configurable via `healthProbes.*` values

**File Changed:** `charts-common/common/wordpress/templates/wp-deployment.yaml`

---

### Issue 4: No Init Container for Database Wait

**Symptom:** WordPress starts before MariaDB is ready, causing connection failures.

**Root Cause:** WordPress deployment started immediately without waiting for database.

**Fix Applied:**
- Added `wait-for-db` init container using busybox
- Uses netcat to check MariaDB port 3306 before starting

**File Changed:** `charts-common/common/wordpress/templates/wp-deployment.yaml`

---

### Issue 5: Hardcoded Root Password Default

**Symptom:** Security vulnerability with predictable root password.

**Root Cause:** Default root password was hardcoded as `"abcd1234"`.

**Fix Applied:**
- Changed default to `randAlphaNum 24` (random 24-char password)

**File Changed:** `charts-common/common/mariadb/templates/secret.yaml`

---

### Issue 6: Values Nesting Mismatch

**Symptom:** Configuration values not applied; using defaults instead.

**Root Cause:** Values path didn't match expected nesting for Helm subcharts.

**Explanation:**
```yaml
# WRONG - values won't propagate
wordpress-site:
  mariadb:
    replicas: 3  # Goes to mariadb chart as root 'replicas'
                 # But template uses .Values.mariadb.replicas

# CORRECT - proper nesting
wordpress-site:
  mariadb:
    mariadb:     # Extra level needed for subchart
      replicas: 3  # Goes to mariadb chart as 'mariadb.replicas'
```

**Fix Applied:**
- Documented correct nesting in values.yaml
- Fixed case10 values.yaml structure

---

### Issue 7: Memory Limits Too Low

**Symptom:** Pods OOMKilled, especially under load.

**Root Cause:** Default memory limits were too conservative for WooCommerce.

**Fix Applied:**
- WordPress: 48Mi → 128Mi (request), 96Mi → 256Mi (limit)
- MariaDB: Already had adequate defaults (512Mi/1024Mi)

**File Changed:** `charts-common/common/wordpress/values.yaml`

---

### Issue 8: Wrong Entrypoint Path in Bootstrap Script

**Symptom:** WordPress pod crashes immediately with `/usr/local/bin/entrypoint.sh: not found`.

**Root Cause:** The bootstrap script called `/usr/local/bin/entrypoint.sh`, but the WordPress FPM image (`ghcr.io/fahdr/wordpress:*-php*-fpm`) has it at `/usr/local/bin/docker-entrypoint.sh`.

**Fix Applied:**
- Changed to call `docker-entrypoint.sh` in the background to set up `wp-config.php`
- Entrypoint runs in background, then is killed after setup completes
- PHP-FPM is started properly at the end with `exec`

**File Changed:** `charts-common/common/wordpress/templates/wp-bootstrap.yaml`

---

### Issue 9: Missing MySQL Tools in WordPress FPM Image

**Symptom:** Bootstrap script waits forever for database with `mysqlcheck: No such file or directory` or `mysql: No such file or directory`.

**Root Cause:** The WordPress FPM image does not include `mysql`, `mysqlcheck`, or other MySQL client tools. Both `wp db check` and `wp db query` require these tools to function.

**Fix Applied:**
- Removed database wait loop from bootstrap script entirely
- Database readiness is now handled by the `wait-for-db` init container (uses netcat to check port 3306)
- The init container guarantees the database is reachable before the bootstrap script runs

**File Changed:** `charts-common/common/wordpress/templates/wp-bootstrap.yaml`

---

### Issue 10: Wrong wp-cli Path

**Symptom:** wp-cli commands fail with `not found` errors.

**Root Cause:** Bootstrap script used `/usr/local/bin/wp/wp` (subdirectory) but the custom image has wp-cli at `/usr/local/bin/wp` (direct binary).

**Fix Applied:**
- Default wp-cli path set to `/usr/local/bin/wp`
- Added fallback detection: checks `/usr/local/bin/wp` first, then `/usr/local/bin/wp/wp`
- Logs which path is being used for debugging

**File Changed:** `charts-common/common/wordpress/templates/wp-bootstrap.yaml`

---

### Issue 11: HPA Scaling Fails with Multi-Attach Error

**Symptom:** Pods repeatedly created and deleted with `Multi-Attach error for volume`. Events show HPA scaling to 2, then back to 1 in a loop.

**Root Cause:** The WordPress PVC uses `ReadWriteOnce` (ceph-block), but the HPA scales to multiple replicas. Only one pod can mount an RWO volume at a time.

**Fix Applied (Temporary):**
- Set HPA `maxReplicas: 1` to prevent scaling
- Neither CephFS nor NFS were available for RWX storage

**Permanent Fix (When RWX storage is available):**
- Change PVC to `ReadWriteMany` with CephFS or NFS storage class
- Restore HPA `maxReplicas` to desired value

**Files Changed:** `charts-common/common/wordpress/values.yaml`, `charts-common/common/wordpress/templates/pvc.yaml`

---

## Troubleshooting Guide

### Pod CrashLoopBackOff

1. **Check logs:**
   ```bash
   kubectl logs <pod-name> -c wordpress
   kubectl logs <pod-name> -c nginx
   ```

2. **Check init container:**
   ```bash
   kubectl logs <pod-name> -c wait-for-db
   ```

3. **Common causes:**
   - Database not ready → Check MariaDB pod status
   - Wrong password → Verify secret contents match database
   - OOM → Increase memory limits

### Database Connection Refused

1. **Verify MariaDB is running:**
   ```bash
   kubectl get mariadb
   kubectl get pods -l app.kubernetes.io/name=mariadb
   ```

2. **Check secret exists with correct name:**
   ```bash
   kubectl get secret <release>-mariadb-secrets -o yaml
   ```

3. **Verify secret has required keys:**
   - `MARIADB_PASSWORD`
   - `MARIADB_ROOT_PASSWORD`
   - `MARIADB_REPL_PASSWORD`

4. **Check secret has MariaDB operator label:**
   ```bash
   kubectl get secret <release>-mariadb-secrets -o jsonpath='{.metadata.labels}'
   # Should include: k8s.mariadb.com/watch: ""
   ```

### External Secret Not Syncing

1. **Check ExternalSecret status:**
   ```bash
   kubectl get externalsecret
   kubectl describe externalsecret <name>
   ```

2. **Verify ClusterSecretStore exists:**
   ```bash
   kubectl get clustersecretstore vaultwarden-fields
   ```

3. **Check Vaultwarden item exists with correct fields**

### Password Out of Sync

1. **Compare secret with database:**
   ```bash
   # Get password from secret
   kubectl get secret <release>-mariadb-secrets -o jsonpath='{.data.MARIADB_PASSWORD}' | base64 -d

   # Test connection
   kubectl exec -it <mariadb-pod> -- mysql -u <user> -p
   ```

2. **If mismatch, update database password:**
   ```sql
   ALTER USER '<user>'@'%' IDENTIFIED BY '<password-from-secret>';
   FLUSH PRIVILEGES;
   ```

3. **Or delete secret and let Helm regenerate (if not using External Secrets):**
   ```bash
   kubectl delete secret <release>-mariadb-secrets
   helm upgrade <release> .
   ```

### Ingress Not Working

1. **Check ingress resource:**
   ```bash
   kubectl get ingress
   kubectl describe ingress <name>
   ```

2. **Verify DNS points to ingress controller**

3. **Check TLS certificate:**
   ```bash
   kubectl get certificate
   kubectl describe certificate <name>
   ```

---

## ArgoCD Integration

### Known Issue: Dependency Update Chicken-and-Egg

When chart dependency versions change, ArgoCD may not properly refresh the helm dependency cache.

**Workaround:** Delete the Application and recreate it:
```bash
kubectl delete application <app-name> -n argocd
# ArgoCD will recreate from ApplicationSet or manually reapply
```

**Alternative Solutions:**
1. Use `argocd.argoproj.io/refresh: hard` annotation
2. Flatten dependency structure
3. Use ApplicationSet with Git generator

---

## Version History

| Version | Changes |
|---------|---------|
| 0.1.6 | Added lookup for secrets, health probes, init container, fixed memory defaults |
| 0.1.8 | Added bootstrap volume mount, TCP probes for nginx |
| 0.1.25 | Current stable version |

---

## File Reference

| File | Purpose |
|------|---------|
| `charts-common/common/mariadb/templates/secret.yaml` | MariaDB secrets with lookup |
| `charts-common/common/mariadb/templates/server.yaml` | MariaDB CRD definition |
| `charts-common/common/mariadb/templates/db.yaml` | Database, User, Grant CRDs |
| `charts-common/common/wordpress/templates/secrets.yaml` | WordPress secrets with lookup |
| `charts-common/common/wordpress/templates/wp-deployment.yaml` | WordPress deployment |
| `charts-common/common/wordpress/templates/wp-bootstrap.yaml` | Bootstrap script ConfigMap |
| `charts-common/common/wordpress/templates/configmap.yaml` | Nginx and env ConfigMaps |
| `sites/case10/` | Example site deployment |
