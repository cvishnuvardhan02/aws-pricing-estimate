# From a client requirements document to an estimate

Use this when the input describes **what the client needs**, such as users, traffic, features, data, compliance or availability, rather than a list of AWS services with sizes. The skill proposes the architecture and the sizing. Every number it derives is shown with its reasoning, and the user confirms it before anything is priced.

## 1. Classify the input

| Input looks like | Path |
|---|---|
| A short brief: customer + MRR + one-line task ("prepare a cc for X, MRR 4000, task …") | `mrr_cc.md`, not this file |
| A list of AWS services with sizes/counts (or a calculator export) | Skip to SKILL.md Step 3 |
| An SOW / proposal (scope, architecture section, cost table such as a CloudZenia SOW's Appendix B) | Use its services, sizes and cost table as **explicit values**, exactly as written. Read the architecture section/diagram for lines the cost table misses. Derive (this file) only what the SOW doesn't specify, and flag any line whose SOW cost differs from the calculator price by more than 2% |
| An architecture diagram | Inventory every icon (SKILL.md Step 2); ask for sizes the diagram doesn't show |
| A requirements doc / RFP / BRD / client brief / email | **This file**, then SKILL.md Step 3 |
| A budget only ("we have $X/month") | This file for the architecture, then `budget_mode.md` |
| A mix | Use explicit values where given; this file for the rest. Never override an explicit value |

## 2. Extract the workload signals

Read the whole document and fill this table. Each row needs a quote or page reference, or "not stated".

| Signal | Value | Source |
|---|---|---|
| Application type (web app, mobile backend, API, data pipeline, AI/chat, batch, internal tool) | | |
| Users: registered, daily active, peak concurrent | | |
| Traffic: requests/sec or per day, peak vs average | | |
| Environments (prod / staging / dev / DR) and their running hours | | |
| Regions / data residency | | |
| Availability target (Multi-AZ, uptime %, RPO/RTO) | | |
| Data: database type, current size, growth/month | | |
| Files/media: volume stored, growth, downloads/month | | |
| Caching / sessions / real-time needs | | |
| Async work: queues, notifications, email/SMS volume | | |
| Search / analytics / reporting | | |
| AI/ML: models, requests/min, tokens/request, documents/month | | |
| Auth (own login, social, SSO, Cognito) | | |
| Security/compliance (WAF, encryption keys, audit logging, HIPAA/PCI/ISO) | | |
| Integrations / third parties | | |
| Existing stack being migrated (source cloud, sizes) | | |
| Budget constraints | | |

The rows marked "not stated" become questions in Step 4. Don't fill them with guesses.

## 3. Propose the architecture

Pick the simplest pattern that meets the stated needs, then map each need to a service. Show it as a table:

| Need (from table above) | AWS service | Why this one | Source |
|---|---|---|---|

Usual starting patterns. They are proposals, never defaults applied silently:
- **Containerised web/API**: CloudFront + S3 (frontend), WAF, ALB, ECS Fargate (or EKS if the client runs Kubernetes), RDS/Aurora, ElastiCache, S3, NAT Gateway, CloudWatch, Secrets Manager, Route 53, ACM.
- **Serverless API**: CloudFront, API Gateway, Lambda, DynamoDB or Aurora Serverless, S3, Cognito, CloudWatch.
- **AI / GenAI app**: either of the above plus Bedrock (model by exact name), a vector store if RAG is in scope (OpenSearch or Aurora pgvector), S3 for documents, Textract if documents are scanned.
- **Lift-and-shift VMs**: EC2 per server (instance type matched to the source vCPU/RAM), EBS, ALB, RDS if the database moves to managed, AWS Backup.

Then run `gap_checklist.md` against the proposal.

## 4. Size it, showing the working

For every number, show the inputs and the arithmetic in a "Derived from" column. If a number needs an assumption, label it **Assumption** and include it in the question batch.

| Line | Value | Derived from |
|---|---|---|
| Fargate tasks | 3 × (1 vCPU, 2 GB), 24×7 | Peak 150 req/s (doc p.4) ÷ assumed 75 req/s per task = 2, + 1 for Multi-AZ spread → 3. **Assumption: 75 req/s per task** |
| RDS storage | 200 GB | 80 GB today (doc p.6) + 8 GB/month × 12 months = 176 GB → round up to 200 |
| Data transfer out | 300 GB/month | 10,000 DAU × 20 page views × 1.5 MB ÷ 1,024 ≈ 293 GB |

Rules of thumb, always labelled as assumptions:
- Storage: today's size + 12 months of growth, rounded up.
- Monthly volumes: daily figures × 30 (the calculator uses 30-day months for per-minute/per-day rates; 730 hours for hourly ones).
- Production databases: Multi-AZ only if the document asks for high availability or an uptime target ≥ 99.9%. Otherwise ask.
- Non-production: smaller sizes and the intake running hours; ask whether non-prod is in scope at all.
- Bedrock: requests/min × 60 × hours/day × 30 × tokens per request. Input and output tokens are priced separately.

## 5. One confirmation round, then build

Present together:
1. The signals table, with "not stated" rows turned into questions
2. The architecture table
3. The sizing table, every assumption labelled
4. The gap checklist items still open

Ask the user to confirm or correct them in **one** reply. Only then write the spec (SKILL.md Step 3). Each spec line's `source` names the document page or "assumption confirmed by <user> <date>".

## 6. Services without a template

Add them to the library inside the calculator tab, without saving anything:

```js
await CZ.addService("<search text>", "<exact service name>")   // returns the new template name
```

Exact names that work (15 Oct 2026):

| Search text | Service name |
|---|---|
| RDS for PostgreSQL | Amazon RDS for PostgreSQL |
| RDS for MySQL | Amazon RDS for MySQL |
| Aurora PostgreSQL | Amazon Aurora PostgreSQL-Compatible DB |
| Aurora MySQL | Amazon Aurora MySQL-Compatible |
| DynamoDB | Amazon DynamoDB |
| ElastiCache | Amazon ElastiCache |
| Fargate | AWS Fargate |
| EKS | Amazon EKS |
| Lambda | AWS Lambda |
| API Gateway | Amazon API Gateway |
| SQS | Amazon Simple Queue Service (SQS) |
| SES | Amazon Simple Email Service (SES) |
| Cognito | Amazon Cognito |
| Elastic File System | Amazon Elastic File System (EFS) |
| Backup | AWS Backup |
| OpenSearch | Amazon OpenSearch Service |
| EventBridge | Amazon EventBridge |
| GuardDuty | Amazon GuardDuty |
| DocumentDB | Amazon DocumentDB (with MongoDB compatibility) |
| Textract | Amazon Textract |

If a name is wrong, the error lists what the search offers. If a form won't save (e.g. Step Functions), configure that one service by hand in the tab, click **Save and view summary**, then run `CZ.harvestCurrent()`.

Templates added this way usually carry only a few fields. Set the rest in the spec from the live schema: `await CZ.fieldInfo("<serviceCode>")` lists every field id with its type, label, allowed units and dropdown option ids. Call `await CZ.prepare(spec)` before `CZ.build(spec)`.

## 7. Traps found in testing

- **RDS / Aurora form defaults** switch on RDS Proxy, Database Insights and Extended Support (`createRDSProxy`, `DatabaseInsightsSelected`, `addRDSExtendedSupport` = "1"). On a db.t4g.medium the three added 43 USD/month (+58%). On 2 × db.r6g.xlarge Multi-AZ, RDS Proxy + Database Insights added 172.28 USD/month and Extended Support added 0.00 (16 Oct 2026). None of them shows in the calculator's config summary. Always present them as inherited values to confirm; set to "0" unless the client needs them.
- **RDS storage**: templates can carry gp2 (`storageVolume: "General Purpose"`). Use gp3 (`"General Purpose-GP3"`) with `gp3Iops` / `gp3Throughput` unless the input says gp2.
- **SaaS products named in a brief** (Kiro, Amazon Quick, Amazon Q): the customer doesn't host them, so they add no servers. See `mrr_cc.md` §2.
- **Dropdowns store option ids, not labels**: Lambda architecture x86 is `"1"` and arm64 is `"2"`. A wrong id silently hides dependent fields and the line prices at 0.00. The engine now rejects values that aren't option ids.
- **Units must be explicit** for fields added from the schema: frequency (`perMonth`, `millionPerMonth`…), storage (`gb|NA`, `gb|month`, `mb|NA`), duration (`sec`, `min`, `hr`, `day`). SQS request fields are in **millions**.
- **Lambda template includes the AWS free tier**: say so in the assumptions.
- **ElastiCache** keeps several instance-row variants in one block. Only the row with nodes > 0 is priced; set `columnFormIPM` with instance type, nodes, family and engine.
- **RDS instance settings** live in the `columnFormIPM` row: set `{ "Instance Type": "db.m7g.large", "Deployment Option": "Multi-AZ", "Number of Nodes": "1" }`.
