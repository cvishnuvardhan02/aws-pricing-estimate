# Gap checklist (run on every inventory before building)

For each item: if the input settles it, record the source. If not, ask. Never silently exclude a plausible line; exclusion needs a "leave it out" from the user.

## Per compute line (EC2, ECS/Fargate, EKS, Lambda, Lightsail)
- [ ] Instance type / vCPU + memory / Lambda memory + duration + invocations
- [ ] Count, per environment
- [ ] Running hours (730 or business hours, from intake)
- [ ] OS and licensing (Linux / Windows / RHEL / SQL Server)
- [ ] Storage per instance: size, type (gp3 default), on the EC2 line only, not duplicated as a separate EBS line
- [ ] Snapshots / backups: frequency, retention, changed GB per snapshot
- [ ] EKS: control plane per cluster, plus the node line
- [ ] Fargate: tasks × vCPU × GB × hours

- [ ] Lambda: free tier included or not (the template includes it); architecture x86/arm64

## Per database / cache / search line
- [ ] RDS/Aurora extras: RDS Proxy, Database Insights, Extended Support. Off unless the client needs them; the calculator form defaults them on
- [ ] Engine, edition, instance class, count
- [ ] Multi-AZ or Single-AZ (Multi-AZ in the input means writer + standby, priced as Multi-AZ)
- [ ] Storage GB, IOPS, backup storage beyond free allocation
- [ ] Read replicas
- [ ] OpenSearch: data nodes, master nodes, storage per node; Serverless has a minimum OCU charge

## Networking (per region)
- [ ] NAT Gateways: count (one per AZ for HA?) and GB processed
- [ ] Load balancers: type (ALB/NLB), count, LCU drivers
- [ ] Public IPv4 addresses in use (charged per hour)
- [ ] VPC interface endpoints: count × AZs
- [ ] Data transfer out to internet: input value, else the intake default
- [ ] Inter-AZ / inter-region transfer for replicated data
- [ ] CloudFront: GB out per geography, requests
- [ ] Route 53: hosted zones, queries, health checks
- [ ] VPN / Direct Connect / Transit Gateway attachments + GB processed

## Security and operations
- [ ] WAF: web ACLs, rules, managed rule groups, requests
- [ ] ACM: public certs free; private CA is paid
- [ ] Secrets Manager: secrets count + API calls
- [ ] KMS: customer-managed keys + requests
- [ ] CloudWatch: custom metrics, log ingestion GB, log storage, dashboards, alarms
- [ ] CloudTrail: extra trails or data events (the first management trail is free)
- [ ] GuardDuty / Security Hub / Config, if named in the input
- [ ] AWS Backup storage

## Storage and messaging
- [ ] S3: GB per storage class, PUT/GET requests, lifecycle transitions
- [ ] ECR: GB stored
- [ ] EFS / FSx: GB, throughput mode
- [ ] SQS / SNS / SES / EventBridge: messages, notifications, emails per month

## AI/ML
- [ ] Bedrock: exact model (by template), inference route (regional/global), requests per minute, hours per day, input and output tokens per request
- [ ] Knowledge Bases / embeddings: ingestion tokens, plus the vector store as its own line
- [ ] SageMaker endpoints: instance type, count, hours

## Whole estimate
- [ ] No line hosts or feeds a SaaS / per-user product (Kiro, Amazon Quick, Amazon Q) unless the user named that service
- [ ] No line exists only to reach a budget or MRR figure
- [ ] Standard platform pieces present, or excluded by the user: CI/CD (CodePipeline + CodeBuild, or the client's own tool), Route 53, CloudTrail, AWS Backup for the database, WAF on a public ALB
- [ ] Usage values come from the input or the baseline table, not the template: ALB GB/hour and connections, S3 requests, NAT GB, CloudWatch logs
- [ ] RDS storage gp3 unless the input says gp2
- [ ] Every environment in the input has its lines (prod, staging, dev, DR)
- [ ] Every region confirmed in intake has its lines, and no others
- [ ] Copies of the same service across regions/environments carry the same fields unless intentionally different
- [ ] No line is counted twice (EBS on EC2 vs EBS line; NAT data both on NAT and as DTO)
