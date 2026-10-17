# Seed estimates (template library)

Estimates built by hand in calculator.aws. Load them all at the start of every run:

```js
await CZ.loadLibrary([
  "4c20f4570c8a6f3db0ef307a0bc5a5ab0eca4964", // PropMatch CC
  "5613fbc7778576d609ad9206647416ac0def8f84", // FastTrack AI
  "c7d8308a479472124db8c11ab97f25360504bf7e", // knox-product-cc
  "51f12e1b18cc1b8cc12d0f0efbd291aa2eebf1ff"  // Datahash CC (hand-built MRR CC: the baseline platform)
])
```

Load Datahash CC last. Every block is also stored as `<name>@<first 6 of estimate id>` (e.g. `amazonRDSPostgreSQLDB__default@51f12e`), so a spec can pick the exact variant even where seeds share a name.

Add new estimate ids to this list whenever the team builds or approves a good estimate. More templates mean fewer services configured by hand in the UI.

| Estimate | Saved monthly | Re-priced 15 Oct 2026 | Services it provides |
|---|---:|---:|---|
| PropMatch CC (ap-south-1) | 1,401.50 | 1,412.82 | EC2 (g4dn), ALB, VPC NAT Gateway + PrivateLink endpoint, EBS gp3 + snapshots, S3 Standard, ECR, Bedrock (Anthropic), CloudWatch, SNS |
| FastTrack AI (us-east-1) | 108.23 | 108.23 | Bedrock Sonnet 5 and Haiku 4.5 lines, S3 Standard |
| knox-product-cc (multi-region) | 846.27 (+7.00 upfront) | 882.92 (+7.00 upfront) | EC2 t3 in 10 regions, VPC public IPv4 + data transfer out, NAT Gateway, ALB, WAF, CloudFront, Route 53, ACM, Secrets Manager, KMS, CloudWatch, CloudTrail, Systems Manager |
| Datahash CC (ap-south-1, built by hand) | 4,000.08 | 4,000.08 (16 Oct 2026) | The MRR baseline platform: Fargate 2 vCPU/4 GB, RDS PostgreSQL gp3 + IOPS + backup storage, ALB with traffic, S3 with request volumes, NAT, CodePipeline, CodeBuild, AWS Backup (RDS), Route 53, CloudTrail, CloudWatch, WAF, KMS, Secrets Manager, ECR. Values in `mrr_cc.md` §3 |

## Acceptance test (run after any engine change)
1. Re-price each seed (the "Checking an existing estimate" recipe in SKILL.md). Totals must equal the "Re-priced" column, unless AWS changed prices since.
2. Build and price this spec. Every line must match `expect_monthly` exactly:

```js
await CZ.bedrockModels("anthropic");
CZ.build({ name: "CZ acceptance test", regions: ["us-east-1","ap-south-1"], services: [
  { template: "ec2Enhancement__default", region: "us-east-1", group: "Production", description: "web t3.small", source: "test",
    set: { instanceType: "t3.small", workload: { data: "1" }, storageAmount: 20 }, expect_monthly: 16.78 },
  { template: "amazonBedrock__anthropic__bedrock-haiku", region: "us-east-1", group: "Production", description: "Sonnet 5 by name", source: "test",
    model: "Anthropic: Claude Sonnet 5", expect_monthly: 72 },
  { template: "amazonBedrock__anthropic__default", region: "ap-south-1", group: "Production", description: "Haiku 4.5 by name", source: "test",
    model: "Anthropic: Claude Haiku 4.5", set: { avgRequestsPerMin: 3, hoursPerDayAtThisRate: 24, avgInputTokensPerRequest: 1500, avgOutputTokensPerRequest: 400 }, expect_monthly: 453.6 },
  { template: "amazonVirtualPrivateCloud__awsPrivateLinkVpc+networkAddressTranslationNatGatewayVpc", region: "ap-south-1", group: "Staging",
    description: "NAT + endpoint Mumbai", source: "test", expect_monthly: 56.97 } ] })
```
Passed on 15 Oct 2026: 4/4 lines exact and 4/4 invalid-input cases rejected. Publish + read-back also passed: https://calculator.aws/#/estimate?id=806fa48ff4a8e3b5555ab18277e069ddcd5e3575 (599.35 USD/month, Production + Staging groups), identical to the priced version with zero differences.

3. Requirements-style dry run (ap-south-1, priced 15 Oct 2026, 707.84 USD/month, zero findings). It covers templates added with `CZ.addService` plus fields added from the live schema:

| Line | Key inputs | Monthly |
|---|---|---:|
| Fargate | 3 tasks/day × 24 hr, vCPU "1", memory {2, gb\|NA} | 113.60 |
| RDS PostgreSQL | columnFormIPM {db.m7g.large, Multi-AZ, 1 node}, 200 GB, extras off | 402.07 |
| ElastiCache | columnFormIPM {cache.t4g.small, 2 nodes, Standard, Redis} | 59.86 |
| S3 Standard | 1,024 GB | 25.60 |
| SES | numberOfEmailMessagesSentFromEC2 {100000, perMonth} | 10.00 |
| NAT Gateway | template defaults | 40.88 |

Also in us-east-1: Lambda 3M requests (millionPerMonth), 200 ms, 512 MB, arch "1" = 0.40; SQS {5, perMonth} = 2.00; Fargate 2 tasks/day × 24 hr, 1 vCPU / 2 GB = 72.08.

4. **MRR CC regression** (16 Oct 2026). The 15-line baseline spec built from the `@51f12e` templates, with customer descriptions and every inherited value confirmed, priced at **4,000.08**, identical to the hand-built Datahash CC. `CZ.check(priced, spec, { target: 4000, require: CZ.MRR_BASELINE })` gave no FAIL; the only WARN was the S3 data-transfer sub-service at 0.00 (inside the free allowance). Lever test to a 2,500 target: RDS 2 → 1 node (3,120.83), then Fargate 16 → 8 tasks, gave **2,514.97** (+0.6%, passes ±1%).
5. **Negative test**: `CZ.check` on the skill's first Datahash run (`de65e59b2a58724872b579a1b39c732cfdccb566`) with the same options must report: 5 FAILs for missing CodePipeline, CodeBuild, Route 53, CloudTrail and AWS Backup; a FAIL for −1.2% off target; a WARN that the EC2 "Kiro workstations" line is 58% of the total; a WARN for RDS on gp2; a WARN for the ALB at 1 GB/hour. Passed on 16 Oct 2026.

73 library entries load from the four seeds: 30 template names plus 43 `@id` variants.

## Known findings in the seeds themselves
- Datahash CC: RDS Extended Support is on (the form default), but prices 0.00 extra for this configuration.
- PropMatch: the saved link prices the Mumbai NAT Gateway and PrivateLink endpoint at N. Virginia rates (45.65 vs 56.97 today). EBS storage is also on both the EC2 line and a separate EBS line.
- knox: VPC data transfer in Mumbai, Tokyo, Singapore and Sydney is saved at N. Virginia rates. A VPC line sits in us-east-2 while its EC2 is in us-east-1. Frankfurt and Singapore EC2 lack the 20 GB EBS that the other copies have.
