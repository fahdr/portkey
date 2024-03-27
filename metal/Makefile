.POSIX:

env ?= prod
export KUBECONFIG = $(shell pwd)/kubeconfig.yaml

default: boot cluster

~/.ssh/id_ed25519:
	ssh-keygen -t ed25519 -P '' -f "$@"

boot: ~/.ssh/id_ed25519
	ansible-playbook \
		--inventory inventories/${env}.yml \
		boot.yml -vv

cluster:
	ansible-playbook \
		--inventory inventories/${env}.yml \
		cluster.yml -vv

console:
	ansible-console \
		--inventory inventories/${env}.yml
