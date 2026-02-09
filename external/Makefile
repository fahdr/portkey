.POSIX:

export KUBECONFIG = $(shell pwd)/../metal/kubeconfig.yaml

default: apply

~/.terraform.d/credentials.tfrc.json:
	terraform login

terraform.tfvars:
	cp terraform.tfvars.example ${@}
	$${EDITOR:-vi} ${@}

.terraform.lock.hcl: ~/.terraform.d/credentials.tfrc.json versions.tf terraform.tfvars
	terraform init
	touch ${@}

namespaces:
	ansible-playbook namespaces.yml

plan: .terraform.lock.hcl
	terraform plan

apply: .terraform.lock.hcl namespaces
	terraform apply -auto-approve
