---
name: aws-pricing-estimate
description: Build an AWS Pricing Calculator (calculator.aws) estimate with a shareable link from a client requirements document, RFP, SOW or proposal, PDF, architecture diagram, list of service values, a monthly budget cap, or a short MRR brief (customer + MRR + one-line task). Use whenever someone asks for an AWS cost estimate, a calculator link, a pricing calculator estimate, a "cc" for a customer, "cost this architecture", "estimate AWS cost for these requirements", "fit this into $X/month", or an estimate that matches an MRR.
---

# AWS Pricing Calculator estimate

Delivers a calculator.aws public link in which **every line was priced by calculator.aws itself**, plus a table tracing each line to its source. Claude never prices, rounds or defaults anything.

## How it works (read once)

- All work happens **inside a calculator.aws browser tab**. Use the built-in browser of the Claude desktop app, or Claude in Chrome. Inject `scripts/calc_engine.js` with the browser's JavaScript tool; it adds `window.CZ`.
- **Templates**: service blocks are cloned from estimates a human built in calculator.aws, so the payload shape is always the calculator's own. `CZ.loadLibrary(ids)` reads them from saved estimates. `CZ.harvestCurrent()` reads them from whatever is open in the tab. Claude only changes input values.
- **Pricing without publishing**: `CZ.price(payload)` loads the draft into the calculator page locally, without any network save. The calculator computes every line exactly as it would in the UI. Saved links are read-only snapshots of the prices at save time, and old links can be stale or wrong, so the skill always re-prices.
- **Publishing**: `CZ.save(priced)` posts the calculator-priced estimate and returns the public link. Only call it after the user approves the priced table.

## Non-negotiable rules

1. **Ask, never assume.** Every input value is either in the source material, answered by the user in this run, or inherited from a template **and shown to the user and confirmed**. `CZ.build` lists unconfirmed values under `inherited`; don't price until that list is empty.
2. **The calculator prices.** Only numbers produced by `CZ.price` reach the user or the link.
3. **Never invent field ids or option values.** Use template fields (`CZ.findTemplate(name).block`) or `CZ.schemaFields(code)`. Pick Bedrock models by exact label from `CZ.bedrockModels(provider)`.
4. **Every line has a description and a source** (document page/section, diagram node, or "user answer").
5. **Nothing is saved without explicit approval.** Show the priced table first; saving creates a public link.
6. **Model the workload, not the product name.** Per-user / SaaS AWS products (Kiro, Amazon Quick, Amazon Q) are not hosted by the customer. Never add servers, "workstations" or pipelines to run or feed them unless the user names those services. Price the application and data platform the task implies.
7. **No filler.** Every line is something the workload runs. Never add a service, or oversize one, just to reach a number.

## Step 0 - Open the calculator and load the engine

1. Open `https://calculator.aws/#/estimate` in a browser tab. Ask for site access if prompted.
2. Read `scripts/calc_engine.js` and run its whole content with the browser's JavaScript tool. Expect `"CZ engine ready"`.
3. Load the library: `await CZ.loadLibrary([<ids from references/seed_estimates.md>, <any estimate links the user gives>])`. Keep the returned template names for Step 3.

If the page reloads at any point, run step 2 again and reload the library.

## Step 1 - Intake (ask EVERY run, all in one message)

1. **Estimate name**: exactly as it should appear. Mention that the link will be public to anyone who has it.
2. **Region(s)** for each environment. Don't default; wait for the answer.
3. **Defaults to confirm**: On-Demand pricing; 730 hours/month; default data transfer out to the internet in GB/month, for lines where the input says nothing; non-production running hours (24×7 or business hours).
4. **Mode**:
   - **Exact**: the values in the input.
   - **Budget cap**: stay under X USD/month (`references/budget_mode.md`; fits automatically).
   - **MRR target**: land on X USD/month, ±1% unless the user says otherwise (`references/mrr_cc.md`). A short brief with a customer name and an MRR is this mode.
5. **Groups**: e.g. Production / Staging / Dev, or none. In MRR mode, propose none.
6. **MRR mode only**: subscription fees for products named in the task (propose: excluded), and any baseline service the client won't use (e.g. GitHub Actions in place of CodePipeline).

## Step 2 - Service inventory and gap sweep

First classify the input (`references/requirements_to_architecture.md` §1):
- **Short MRR brief** (customer, MRR, one-line task, no document): follow `references/mrr_cc.md`. Start from the 15-line baseline platform, add only the lines the task really implies, and scale to the MRR.
- **Requirements doc / RFP / brief** (users, traffic, features, data, compliance, but no AWS sizing): follow `references/requirements_to_architecture.md`. Extract the workload signals, propose the architecture, size it with every derivation shown, and get one confirmation round. Its output is the inventory below.
- **SOW / proposal**: its services, sizes and cost table are explicit values, used exactly as written. Put each SOW line cost in `expect_monthly`, so any line the calculator prices more than 2% differently is flagged for the user. Derive only what the SOW leaves out.
- **Service list, diagram or calculator export**: build the inventory directly. For diagrams, list every icon, including small ones: NAT gateways, endpoints, WAF, Route 53, KMS.
- **Mixed**: explicit values win; derive only what's missing.

Put the inventory in chat:

| # | Service | Region | Group | What it is | Sizing / usage | Source |
|---|---|---|---|---|---|---|

Run `references/gap_checklist.md`. Ask every open question in **one** numbered batch, each with a proposed value. Don't build until they're answered.

## Step 3 - Spec and build

Write the spec (format: `references/spec_format.md`), then:

```js
const spec = {...};
await CZ.bedrockModels("anthropic");   // only if the spec has Bedrock lines
await CZ.prepare(spec);                 // loads live-schema field info for every service in the spec
const { payload, report } = CZ.build(spec);
report
```

- **No template for a service?** Run `await CZ.addService("<search text>", "<exact service name>")` (names in `references/requirements_to_architecture.md` §6). It adds the service in this tab without saving anything and returns the new template name. If its form won't save, configure it by hand in the tab, then run `CZ.harvestCurrent()`.
- **Fields a template doesn't carry**: set them anyway. The engine accepts any field the live schema has, with checks. `await CZ.fieldInfo("<serviceCode>")` lists ids, labels, allowed units and dropdown option ids. Dropdowns take **option ids** (Lambda x86 = "1"), and frequency, storage and duration fields need `{ value, unit }`.
- `report.errors`: fix the spec. Never drop a line to clear an error.
- `report.services[i].inherited`: show these values to the user as a table per line, get a yes, and add the accepted ids to that line's `confirm`. Rebuild until every `inherited` is empty. Watch for RDS/Aurora `createRDSProxy`, `DatabaseInsightsSelected` and `addRDSExtendedSupport`: the form defaults them on, and they add real cost.

## Step 4 - Price and check (nothing published yet)

```js
const priced = await CZ.price(payload, 45000);
({ lines: CZ.lines(priced), findings: CZ.check(priced, spec, {
    budget: <cap or null>,                                   // budget mode
    target: <MRR or null>, require: <CZ.MRR_BASELINE or []>  // MRR mode
}) })
```

- **FAIL** (a paid line at 0.00, line count ≠ spec, over budget, off the MRR target by more than the tolerance, a baseline service missing in MRR mode, off `expect_monthly` by more than 2%): fix and re-run Steps 3–4.
- **WARN** (EBS double count, networking without compute in a region, inconsistent copies, a 0.00 sub-service, RDS on gp2, RDS Proxy or Database Insights on, an ALB with almost no traffic, one line over 50% of an MRR CC): resolve with the user.
- Budget mode: follow `references/budget_mode.md`, repeating Steps 3–4 per round.
- MRR mode: follow `references/mrr_cc.md` §4, repeating Steps 3–4 per lever until the target check passes.

Show the user the priced table (group, service, region, description, monthly, upfront, source), the totals, and any remaining warnings. Ask for approval to publish.

## Step 5 - Publish and verify

Only after the user approves:

```js
const link = await CZ.save(priced);
const back = await CZ.read(link.id);
({ link, diffs: CZ.compare(priced, back) })   // must be []
```

If `diffs` isn't empty, don't deliver. Report it.

## Step 6 - Deliver

1. The link
2. Monthly, upfront and 12-month totals
3. The per-line table with sources
4. Assumptions: every confirmed default and inherited value, in plain words
5. Budget mode only: the "Budget fit" table
6. MRR mode only: the total vs the MRR, each line's share, and what was excluded (e.g. Kiro / Quick subscription fees)

Then suggest adding the link to `references/seed_estimates.md`, so future runs can reuse its blocks.

## Checking an existing estimate

The same engine audits any saved link without changing it:

```js
const saved = await CZ.read("<link>");
const now = await CZ.price(Object.assign(CZ.zero(saved), { name: saved.name + " [recheck]" }));
({ diffs: CZ.compare(saved, now), findings: CZ.check(now) })
```

`diffs` are lines whose saved price differs from what the calculator computes today. For example, a line moved to Mumbai can still carry N. Virginia prices.

## Known traps

- **EBS double count**: the EC2 line has its own EBS storage; don't add a separate EBS line for the same volumes (a snapshots-only EBS line is fine).
- **Stale saved prices**: copying a line to another region in the UI can keep the old region's price until "Update estimate". Always price through `CZ.price`.
- **Bedrock**: models are opaque ids. Always set `model` by exact label; the engine sets every linked field (selected model, on-demand, caching, per-route).
- **Multi-region copies**: every copy carries the same fields unless the user says otherwise.
- **Region slips**: networking in a region with no compute is almost always a typo.
- **Read-only lines**: if the calculator marks a line read-only, its template is older than the live schema. Re-create that service in the UI and `CZ.harvestCurrent()` it.
- **SaaS products in the task** (Kiro, Amazon Quick, Amazon Q): no servers for them. See rule 6 and `references/mrr_cc.md` §2.
- **Template idle values**: templates can carry token usage (ALB 1 GB/hour, S3 5 M GETs). Set usage from the brief or the baseline table, never leave it at the template's value unconfirmed.
- **Same-named templates**: lines without a description get the same name in every seed (`amazonRoute53__default`); the last seed loaded wins that name. Each block is also kept as `<name>@<first 6 of estimate id>`; use that form to pick an exact variant.
