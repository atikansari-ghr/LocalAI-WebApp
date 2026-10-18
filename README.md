# LocalAI-WebApp

Independent, locally hosted AI platform for Workspace users and application clients.

Target: Debian 13 Proxmox LXC, 4 vCPU, 6 GB RAM, 100 GB disk, native systemd without Docker.

The [master build specification](LOCAL_AI_MASTER_BUILD_PROMPT.md) defines the implementation and release requirements. [Recovered decision details](docs/requirements/decision-details.md) preserve all 110 Local AI decisions and their historical context.

Status: specification review. Application implementation and production qualification have not started. No production release is available. PDMS and Family Calendar integrations are API contracts/examples only.

Development uses feature branches and pull requests. Release promotion requires complete automated evidence, including security/isolation, target-host performance, backup/restore, migration and rollback checks.
