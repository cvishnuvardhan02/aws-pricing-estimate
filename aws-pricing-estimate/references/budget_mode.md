# Budget mode: best fit under a monthly cap (automatic)

The user gives a cap in USD/month. The skill fits the estimate under it without asking about each change, and reports every change afterwards.

A cap means "stay under". An **MRR** ("prepare a cc for X, MRR 4000") means "land on it": use `mrr_cc.md`, not this file.

## Hard limits (never changed to meet a budget)
- Pricing model stays **On-Demand**.
- Anything the input states explicitly: named instance types, counts, Multi-AZ, regions, retention periods.
- Production high availability that the input asks for.
- Services the input names stay in. They can be resized, not removed.

## Procedure
1. Build the **baseline**: the requirement-faithful estimate, sized for the workload described. Price it with `CZ.price`.
2. If the total is at or under the cap, deliver it and state the headroom.
3. Otherwise apply levers **in this order**, one round at a time. Each round is one `CZ.build` + `CZ.price`, maximum 5 rounds:
   1. Newer-generation equivalents at the same vCPU/memory (e.g. m5 → m7i); Graviton only if the input doesn't rule out ARM.
   2. gp2 → gp3; trim over-provisioned IOPS/throughput to the gp3 baseline.
   3. Non-production: business-hours running (intake hours), smaller sizes, Single-AZ, one NAT gateway.
   4. Usage assumptions Claude chose rather than the user (log ingestion, request counts, the default DTO): bring them down to the conservative end of what the input supports.
   5. Production compute one size down, only where the input gives no sizing.
4. Stop at the first round that fits under the cap. Don't cut further.
5. If the cap can't be met without breaking a hard limit, stop. Deliver the lowest compliant estimate and say how far over the cap it is and which limit blocks further cuts.

## Report
Add a "Budget fit" table:

| Round | Change | Lines affected | Monthly before | Monthly after |
|---|---|---|---:|---:|

End it with the final total vs the cap.
