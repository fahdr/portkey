# Talos Migration - Choose Your Approach

Two migration strategies are available depending on your downtime tolerance:

## 🚀 Simplified Migration (Recommended for Your Scenario)

**File**: [talos-migration-simplified.md](talos-migration-simplified.md)

**When to use**: No critical apps, downtime acceptable

**Process**:
1. Backup everything
2. Wipe all nodes simultaneously
3. Deploy Talos to all 4 nodes at once
4. Bootstrap cluster
5. Restore apps from backups

**Advantages**:
- ✅ **Fast**: 4-6 hours total (vs 4-5 weeks)
- ✅ **Simple**: Single clean cutover, no complex orchestration
- ✅ **Clean slate**: Fresh Talos install on all nodes
- ✅ **Easier to execute**: No gradual migration complexity
- ✅ **Full HA from day 1**: 4-node cluster immediately

**Disadvantages**:
- ⚠️ **Downtime**: 4-6 hours of full cluster downtime
- ⚠️ **Rollback requires VM snapshots**: Must restore from Proxmox

**Timeline**:
```
Day 1:
├─ Morning: Pre-migration backups (30 min)
├─ Midday: Wipe K3s, deploy Talos (1 hour)
├─ Afternoon: Deploy storage, ArgoCD, apps (2-3 hours)
└─ Evening: Verify and celebrate! 🎉
```

---

## 🔄 Rolling Migration (Production-Grade)

**File**: [k3s-to-talos-migration.md](k3s-to-talos-migration.md)

**When to use**: Critical production apps, zero-downtime required

**Process**:
1. **Phase 1**: Convert metal2, add rivendell → 2-node Talos cluster
2. **Phase 2**: Migrate low-risk apps gradually
3. **Phase 3**: Add metal1 → 3-node HA
4. **Phase 4**: Migrate critical apps, add metal0
5. **Phase 5**: Cleanup

**Advantages**:
- ✅ **Zero downtime**: K3s keeps running during migration
- ✅ **Gradual risk**: Test each phase before proceeding
- ✅ **Per-app rollback**: Can revert individual apps
- ✅ **Production-safe**: Minimal service disruption

**Disadvantages**:
- ⏱️ **Slow**: 4-5 weeks total
- 🔧 **Complex**: 5 phases, careful orchestration required
- 📋 **More work**: Per-app migration procedures

**Timeline**:
```
Week 1: Bootstrap Talos cluster (2 nodes)
Week 2-3: Migrate 8-12 low-risk apps
Week 3: Add metal1 (HA control plane)
Week 4: Migrate critical apps, add metal0
Week 5: Cleanup and finalize
```

---

## Comparison Table

| Aspect | Simplified | Rolling |
|--------|-----------|---------|
| **Downtime** | 4-6 hours | Near-zero |
| **Duration** | 1 day | 4-5 weeks |
| **Complexity** | Low | High |
| **Rollback** | VM snapshots (full cluster) | Per-phase or per-app |
| **Risk** | Medium | Low |
| **Best for** | Non-production, dev/staging | Production, critical apps |
| **Your scenario** | ✅ **Recommended** | Overkill |

---

## Recommendation for Your Scenario

Since you have:
- ✅ No critical apps running
- ✅ Downtime acceptable
- ✅ Non-production environment

**Use the Simplified Migration** ([talos-migration-simplified.md](talos-migration-simplified.md))

You'll have a fully functional 4-node Talos cluster by end of day, with much less effort than the rolling migration.

---

## Both Guides Available

- **[talos-migration-simplified.md](talos-migration-simplified.md)** - Your guide (4-6 hours)
- **[k3s-to-talos-migration.md](k3s-to-talos-migration.md)** - Reference for future production migrations

All Ansible automation works with both approaches!

---

**Next Steps**: Read [talos-migration-simplified.md](talos-migration-simplified.md) and start when ready! 🚀
