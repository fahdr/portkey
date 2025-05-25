# VolSync Backups Helm Library Chart

This Helm library chart provides reusable templates for managing [VolSync](https://backube.github.io/volsync/) backup resources in your Kubernetes applications. It is designed to be used as a dependency in your application charts, enabling you to easily provision `PersistentVolumeClaim`, `ReplicationSource`, `ReplicationDestination`, and Restic Secret resources with sensible defaults and flexible overrides.

---

## Features

- **Reusable PVC, ReplicationSource, ReplicationDestination, and Restic Secret templates**
- **Safe defaults**: Uses the Helm release name and namespace if not specified
- **Highly configurable**: Override any value via your app's `values.yaml`
- **Supports multiple instances**: Use Helm's `alias` feature to include multiple VolSync backup sets in a single app

---

## Usage

### 1. Add as a Dependency

In your app's `Chart.yaml`:

```yaml
dependencies:
  - name: volsync-backups
    version: 0.1.0
    repository: "file://../../charts-common/volsync-backups"
```

Or, to use multiple backup sets:

```yaml
dependencies:
  - name: volsync-backups
    version: 0.1.0
    repository: "file://../../charts-common/volsync-backups"
    alias: volsync-backups-db
  - name: volsync-backups
    version: 0.1.0
    repository: "file://../../charts-common/volsync-backups"
    alias: volsync-backups-media
```

---

### 2. Configure in Your `values.yaml`

Example for a single backup set:

```yaml
volsyncPVC:
  name: myapp-pvc
  storage: 5Gi
  storageClassName: ceph-block

replicationDestination:
  name: myapp-dst

resticSecret:
  repository: s3:s3.amazonaws.com/mybucket/myrepo
  password: supersecret
  awsAccessKeyId: <your-access-key>
  awsSecretAccessKey: <your-secret-key>
```

If you use aliases, configure each under its alias name:

```yaml
volsync-backups-db:
  volsyncPVC:
    name: db-pvc
    storage: 10Gi
  replicationDestination:
    name: db-dst
  resticSecret:
    repository: s3:s3.amazonaws.com/mybucket/dbrepo
    password: dbsecret

volsync-backups-media:
  volsyncPVC:
    name: media-pvc
    storage: 100Gi
  replicationDestination:
    name: media-dst
  resticSecret:
    repository: s3:s3.amazonaws.com/mybucket/mediarepo
    password: mediasecret
```

---

### 3. Template Rendering

The library chart templates use Helm’s `default` function and `.Release.Name` to provide safe defaults. For example, if you do not specify a PVC name, it will default to the Helm release name.

---

### 4. Example Output

A rendered `PersistentVolumeClaim` might look like:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: myapp-pvc
spec:
  accessModes:
    - ReadWriteOnce
  dataSourceRef:
    kind: ReplicationDestination
    apiGroup: volsync.backube
    name: myapp-dst
  resources:
    requests:
      storage: 5Gi
  storageClassName: ceph-block
```

---

## Notes

- This chart is a **library chart**: it is not meant to be installed directly, but to be used as a dependency.
- If you use it as a library chart, you must include its templates in your app chart using `{{ include }}`. If you want automatic rendering, set it as an application chart.
- All resources are rendered in the release namespace by default, unless overridden.

---

## License

MIT