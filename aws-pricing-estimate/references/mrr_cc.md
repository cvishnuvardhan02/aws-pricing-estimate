# MRR CC: an estimate sized to a customer's MRR

Use this when the request is a **short brief**: a customer name, an MRR figure and a one-line task, with no requirements document. Example: *"Prepare a cc for Datahash. MRR: 4000. Task: Kiro and Quick deployment for the internal users."*

- **CC** is the calculator estimate. **MRR** is the monthly AWS spend the estimate must show.
- The estimate shows the AWS infrastructure the customer would run for the task, priced at the MRR. Reviewers expect the standard, defensible production platform the team builds by hand, not a speculative design.
- MRR is a **target to land on**, not a cap to stay under (that is `budget_mode.md`).

## 1. Intake (in addition to SKILL.md Step 1)

| Ask | Default to propose |
|---|---|
| Estimate name | `<Customer> CC` |
| MRR target and tolerance | Within ±1%. Hand-built CCs land almost exactly: Datahash 4,000.08 for 4,000 |
| Region | Ask. Never default |
| Groups | None. Hand-built CCs have no groups |
| Subscription fees of products named in the task (Kiro, Amazon Quick, Amazon Q) | Excluded, and said so in the assumptions. Include one only if the user asks and the calculator lists it |
| Anything the client already has or won't use (e.g. GitHub Actions instead of CodePipeline) | Nothing excluded |

## 2. Read the task as a workload, not a shopping list

The task says what the users will do. Model the AWS workload behind it.

**Per-user / SaaS products are not hosted by the customer.** Kiro is an IDE on the developer's laptop with a per-user subscription. Amazon Quick (Quick Suite, QuickSight, Quick Index, Quick Flows, Quick Research), Amazon Q Developer and Amazon Q Business are managed SaaS. **Never add EC2 "workstations" or "dev boxes", Glue/Athena pipelines, or other servers to run or feed them** unless the user names those services.

| Task wording | Workload to model |
|---|---|
| Kiro, AI coding, developer productivity | The internal application the developers build and run: the baseline platform (§3) |
| Amazon Quick, QuickSight, BI, dashboards for internal users | The application data it reads: the baseline's RDS + S3. Add Glue/Athena only if the task says ETL or data lake |
| "Deployment for internal users", internal tool, portal | Internal application: the baseline platform |
| GenAI, chatbot, agents | Baseline + Bedrock (model by exact label), + OpenSearch or pgvector if RAG |
| Data pipeline, analytics platform | Baseline + Glue, Athena, S3 storage classes |
| VM migration, lift and shift | EC2 per server in place of Fargate, + baseline networking, database, ops |

"Kiro and Quick deployment for internal users" is the baseline platform on its own. That is what the hand-built Datahash CC contains.

Security add-ons (GuardDuty, Config, Security Hub, Inspector), VPC interface endpoints and extra groups go in only if the task or the user names them.

## 3. Baseline platform (every MRR CC)

15 lines from the hand-built **Datahash CC** (seed `51f12e…`, ap-south-1, 4,000.08 USD/month, re-priced 16 Oct 2026 with zero differences). Load the seed and use the `@51f12e` template names; they carry these exact values.

| # | Service | Template | Datahash values | Monthly | Share |
|---|---|---|---|---:|---:|
| 1 | RDS PostgreSQL | `amazonRDSPostgreSQLDB__default@51f12e` | 2 × db.r6g.xlarge Multi-AZ, 500 GB gp3, 12,000 IOPS, 500 MiBps, 500 GB backup storage | 1,806.00 | 45.1% |
| 2 | Fargate | `awsFargate__datahash-internal-application-fargate@51f12e` | 16 tasks × 2 vCPU / 4 GB, 24×7 (1,440 min/day), Linux x86, 20 GB ephemeral | 1,211.69 | 30.3% |
| 3 | ALB | `elasticLoadBalancing__applicationLoadBalancer__default@51f12e` | 1 ALB, 56 GB/hour processed, 10 new connections/s, 60 s duration, 5 requests/s | 344.49 | 8.6% |
| 4 | S3 | `amazonSimpleStorageServiceGroup__amazonS3Standard+awsS3DataTransfer__default@51f12e` | 1 TB Standard, 10 M PUT, 500 M GET, 100 GB in / 100 GB out | 275.60 | 6.9% |
| 5 | CloudWatch | `amazonCloudWatch__default@51f12e` | 50 metrics, 100 GB logs + 100 GB vended logs, 10 GB Insights scanned, 2 dashboards, 17 alarms + 2 composite | 154.69 | 3.9% |
| 6 | VPC NAT Gateway | `amazonVirtualPrivateCloud__networkAddressTranslationNatGatewayVpc__default@51f12e` | 2 NAT gateways + 1 regional NAT (1 AZ), 250 GB processed each | 109.76 | 2.7% |
| 7 | WAF | `awsWebApplicationFirewall__default@51f12e` | 1 web ACL, 15 rules, 15 managed rule groups, 2 M requests | 36.20 | 0.9% |
| 8 | AWS Backup | `awsBackup__rdsBackup__default@51f12e` | RDS 500 GB; continuous 7 d, daily 30 d, weekly 4 w, monthly 3 m | 32.85 | 0.8% |
| 9 | ECR | `amazonElasticContainerRegistry__default@51f12e` | 100 GB stored, 50 GB out | 10.00 | |
| 10 | KMS | `awsKeyManagementService__default@51f12e` | 2 CMKs, 1 M requests | 5.00 | |
| 11 | Route 53 | `amazonRoute53__default@51f12e` | 1 hosted zone, 10 M queries | 4.50 | |
| 12 | Secrets Manager | `awsSecretsManager__default@51f12e` | 10 secrets, 100,000 API calls | 4.50 | |
| 13 | CodeBuild | `awsCodeBuild__default@51f12e` | 60 builds × 10 min, general1.small Linux | 3.00 | |
| 14 | CodePipeline | `awsCodePipeline__datahash-ci-cd-pipeline@51f12e` | V2, 1,000 action minutes | 1.80 | |
| 15 | CloudTrail | `awsCloudTrail__default@51f12e` | 1 management trail | 0.00 | |

The shape to keep: compute + database about 75% of the total, edge and networking (ALB, NAT, WAF) about 12%, storage about 7%, operations, security and CI/CD about 6%. No single line above 50%.

`CZ.MRR_BASELINE` lists these 15 service codes. `CZ.check` fails a CC that lacks one, unless the spec's `exclude` names it with the user's reason.

## 4. Scale to the MRR

The calculator prices every step. Claude only picks sizes.

1. Write the spec from the baseline table with the customer's descriptions (`<Customer> <purpose> - <service>`, e.g. "Datahash Internal Application - Fargate"). Price it in the customer's region.
2. Add the task's extra lines from §2, sized from the brief.
3. Close the gap to the target with these levers, in order, pricing after each change:
   1. Fargate task count: fine steps (each 2 vCPU / 4 GB task is about 76 USD/month in Mumbai).
   2. RDS instance class (db.r6g.large ↔ xlarge ↔ 2xlarge) and node count: coarse steps.
   3. ALB processed GB/hour and S3 request volume: final trim.
   Don't inflate the small operations lines to fill the target.
4. If the target is more than about twice the baseline, ask whether to add a staging environment or scale production, rather than guessing.
5. Done when `CZ.check(priced, spec, { target: <MRR>, require: CZ.MRR_BASELINE })` has no FAIL. Resolve the WARNs with the user.

Show the user the priced table with each line's share of the total before asking to publish.

## 5. The first Datahash run, for comparison

The skill's first attempt (`de65e5…`, 3,952.28 USD/month) vs the hand-built CC (`51f12e…`, 4,000.08):

| Problem in the skill's run | Effect | Fixed by |
|---|---|---|
| Built infrastructure for SaaS products: 14 × m7i.xlarge "Kiro remote dev workstations" | 2,295.34 USD, 58% of the total, on a line the workload doesn't need | §2 rule; `CZ.check` WARN for a line over 50% of an MRR CC |
| Invented a "Quick Data Layer": Glue (264.00) and Athena (14.65) | Speculative lines | §2 table: Glue/Athena only with ETL or data lake in the task |
| Added GuardDuty (90.80), Config (50.00) and 4 interface endpoints, none requested | Filler | §2: security add-ons only if named |
| Missing CodePipeline, CodeBuild, Route 53, CloudTrail, AWS Backup | Not the standard platform | `require: CZ.MRR_BASELINE` FAILs |
| Core platform undersized: Fargate 8 × 1 vCPU / 2 GB (302.92), RDS 1 × db.r7g.large (528.12) | Compute + database 21% instead of 75% | §3 shape; §4 levers |
| ALB at 1 GB/hour (23.29) and S3 at 5 M GET (55.70) | Template idle values | `CZ.check` ALB WARN; baseline usage values |
| RDS storage gp2 inherited from the template | Not the house standard | `CZ.check` gp2 WARN |
| Four invented groups | Hand-built CCs have none | §1 default: no groups |
| 1.2% under the MRR | Off target | `CZ.check` target FAIL (±1%) |
