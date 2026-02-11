.POSIX:

export KUBECONFIG = $(shell pwd)/kubeconfig.yaml
export TALOSCONFIG = $(shell pwd)/talos-configs/talosconfig
INVENTORY = inventories/talos.yml

default: cluster

cluster: apply-configs talos-bootstrap post-bootstrap

apply-configs:
	ansible-playbook -i $(INVENTORY) playbooks/talos-apply-configs.yml

talos-bootstrap:
	talosctl --talosconfig talos-configs/talosconfig bootstrap --nodes 192.168.0.11

post-bootstrap:
	ansible-playbook playbooks/talos-post-bootstrap.yml

create-vms:
	ansible-playbook -i $(INVENTORY) playbooks/talos-create-vms.yml

upgrade:
	ansible-playbook -i $(INVENTORY) playbooks/talos-upgrade.yml
