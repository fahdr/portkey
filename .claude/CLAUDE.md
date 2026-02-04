I have a 6 node proxmox cluster. 3 nodes are running vms that run kubernetes. Each node has an nvme that is running ceph. The kubernetes cluster has rook with external cluster configuration. One of my proxmox nodes has 8 disks configured with zfs. This is shared as nfs and samba using an lxc container with the zfs folder mounted and run using turnkey file share container with webmin installed. This proxmox node also has opnsense running as a vm. Opnsense has adguard installed as a plugin.

shire - 192.168.0.2, rivendell - 192.168.0.202, isengard - 192.168.0.102,mirkwood - 192.168.0.8, rohan -192.168.0.7, gondor - 192.168.0.6

My networking goes like this:
- wan connected to opnsense vm via proxmox bridge vmbr0
- opnsense vm has 2 interfaces, one for wan (vmbr0) and one for lan (vmbr1)
- lan interface (vmbr1) is connected to a switch that connects to all other proxmox nodes and my home devices, wireless router running in ap mode only using openwrt firmware