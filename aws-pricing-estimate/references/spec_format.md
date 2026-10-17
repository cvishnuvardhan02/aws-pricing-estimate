# Spec format (input to CZ.build)

```js
{
  name: "Acme - Production v1",
  regions: ["ap-south-1"],
  defaults: { pricingModel: "On-Demand", hoursPerMonth: 730, defaultDtoGbPerMonth: 100, nonProdHours: "24x7" },
  services: [
    {
      template: "ec2Enhancement__default",     // a name from CZ.loadLibrary / CZ.harvestCurrent
      region: "ap-south-1",
      group: "Production",                      // optional
      description: "API servers (2x m6i.large)",
      source: "Client brief p.2 s3.1",
      set: { instanceType: "m6i.large", workload: { data: "2" }, storageAmount: 50 },
      confirm: ["tenancy", "selectedOS", "workloadSelection", "pricingStrategy"],
      expect_monthly: null                      // optional: checked within 2% after pricing
    },
    {
      template: "amazonBedrock__anthropic__default",
      region: "us-east-1",
      description: "Chat assistant",
      source: "Brief p.4",
      model: "Anthropic: Claude Sonnet 5",      // exact label from await CZ.bedrockModels("anthropic")
      set: { avgRequestsPerMin: 3, hoursPerDayAtThisRate: 24, avgInputTokensPerRequest: 1500, avgOutputTokensPerRequest: 400 }
    }
  ]
}
```

| Key | Required | Meaning |
|---|---|---|
| `name` | yes | Estimate name, exactly as the user gave it |
| `regions` | yes | Regions the user confirmed; a line outside them is an error |
| `defaults` | yes | Intake answers, recorded for the report |
| `services[].template` | yes | Template name (exact, or a unique prefix) |
| `services[].region` | yes | AWS region code |
| `services[].group` | no | Group name |
| `services[].description` | yes | What the line is; shown on the calculator line |
| `services[].source` | yes | Where its numbers came from |
| `services[].set` | as needed | Field id → value for every value this line changes |
| `services[].model` | Bedrock | Model label; sets every linked model field |
| `services[].confirm` | as needed | Template values the user accepted unchanged |
| `services[].expect_monthly` | no | Expected line cost, for regression checks |
| `exclude` | MRR mode | Baseline service codes left out on purpose, with the user's reason: `{ awsCodePipeline: "client uses GitHub Actions (user, 16 Oct)" }` |

## Writing values

- **Scalar** (`instanceType: "m6i.large"`): replaces the component's value, keeping its unit and type.
- **Object without `value`** (`workload: { data: "2" }`): merged into the component's object value.
- **Object with `value`** (`storageAmount: { value: "50", unit: "gb|NA" }`): replaces the component, unit included.
- **Lists** (data-transfer rows): give the full list, copying the row shape from the template. Rows use `entryType`:

```js
dataTransferForEC2: { value: [
  { entryType: "INBOUND", value: "", unit: "tb_month", fromRegion: "" },
  { entryType: "OUTBOUND", value: "100", unit: "gb_month", toRegion: "internet" },
  { entryType: "INTRA_REGION", value: "", unit: "tb_month" }
] }
```

Before writing a list, look at the template (`CZ.findTemplate("ec2Enhancement__default").block`) and copy its exact unit ids and option values. The OUTBOUND row above illustrates the pattern only. The engine finds fields inside sub-services (VPC → NAT Gateway, S3 → S3 Standard, Bedrock → anthropic) by id.

Template names are `<serviceCode>__<sub-service codes>__<description slug>`, for example `amazonVirtualPrivateCloud__awsPrivateLinkVpc+networkAddressTranslationNatGatewayVpc__default`. List the loaded ones with `Object.keys(CZ.library)`.

Lines without a description share a name across seeds (`amazonRoute53__default`), and the last seed loaded wins it. Every block is also stored as `<name>@<first 6 characters of its estimate id>`, e.g. `amazonRDSPostgreSQLDB__default@51f12e`. Use that form to pick an exact variant; prefix matching ignores these names.
