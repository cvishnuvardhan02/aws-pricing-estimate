/* aws-pricing-estimate in-page engine.
 *
 * Inject into a calculator.aws tab (javascript tool), then call window.CZ.* .
 * Everything runs inside the calculator page, so it reaches the same endpoints
 * the calculator uses and is priced by the calculator's own code.
 *
 *   await CZ.read(idOrUrl)            -> saved estimate JSON
 *   await CZ.loadLibrary([ids])       -> index of template blocks harvested from estimates
 *   CZ.build(spec)                    -> {payload, report}  (report lists errors / inherited values)
 *   await CZ.price(payload)           -> estimate as computed by calculator.aws (NOT saved)
 *   CZ.lines(est)                     -> flat per-line table
 *   CZ.check(computed, spec, opts)    -> findings [{level, msg}]
 *        opts: { budget, target, targetTolerance, require: CZ.MRR_BASELINE, tolerance }
 *   CZ.compare(saved, computed)       -> per-line differences between two versions
 *   await CZ.save(computed)           -> {id, url}   PUBLISHES a public link - only after the user approves
 */
(() => {
  const READ = "https://d3knqfixx3sbls.cloudfront.net/";
  const CDN = "https://d1qsjq9pzbk1k6.cloudfront.net";
  const SAVE = "https://dnd5zrqcec4or.cloudfront.net/Prod/v2/saveAs";
  const STATE_KEY = "awspc-root-estimate-v1";
  const FREE_OK = new Set(["awsSystemsManager", "awsCertificateManager", "awsCloudTrail",
    "awsIdentityAndAccessManagement", "awsOrganizations", "awsCloudFormation"]);

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const idOf = (ref) => String(ref).split("id=").pop().split("&")[0].trim();
  const slug = (t) => (t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "default";
  const val = (c) => (c && typeof c === "object" && "value" in c ? c.value : c);

  function* walk(est, path = []) {
    for (const [key, b] of Object.entries(est.services || {})) yield { path, key, b };
    for (const [gk, g] of Object.entries(est.groups || {})) yield* walk(g, path.concat(g.name || gk));
  }

  function templateName(b) {
    const subs = (b.subServices || []).map((s) => s.serviceCode).filter(Boolean).sort().join("+");
    return [b.serviceCode, subs, slug(b.description)].filter(Boolean).join("__");
  }

  function components(b) {
    const out = { ...(b.calculationComponents || {}) };
    for (const s of b.subServices || []) for (const [k, v] of Object.entries(s.calculationComponents || {})) if (!(k in out)) out[k] = v;
    return out;
  }

  function holders(b) {
    const m = {};
    for (const s of b.subServices || []) for (const k of Object.keys(s.calculationComponents || {})) m[k] = s.calculationComponents;
    for (const k of Object.keys(b.calculationComponents || {})) m[k] = b.calculationComponents;
    return m;
  }

  function zero(est) {
    const e = clone(est);
    for (const { b } of walk(e)) {
      b.serviceCost = { monthly: 0, upfront: 0 };
      b.configSummary = "";
      for (const s of b.subServices || []) s.serviceCost = { monthly: 0, upfront: 0 };
    }
    e.groupSubtotal = { monthly: 0, upfront: 0 };
    e.totalCost = { monthly: 0, upfront: 0 };
    const zg = (g) => { g.totalCost = { monthly: 0, upfront: 0 }; Object.values(g.groups || {}).forEach(zg); };
    Object.values(e.groups || {}).forEach(zg);
    return e;
  }

  async function read(ref) {
    const r = await fetch(READ + idOf(ref));
    if (!r.ok) throw new Error("read " + idOf(ref) + ": HTTP " + r.status);
    return r.json();
  }

  const library = Object.assign({}, (window.CZ && window.CZ.library) || {}); // survive re-injection
  async function loadLibrary(ids) {
    const loaded = [];
    for (const id of ids) {
      const est = await read(id);
      for (const { b } of walk(est)) {
        const name = templateName(b);
        const cur = library[name];
        const newer = !cur || String(b.version).localeCompare(String(cur.block.version), undefined, { numeric: true }) >= 0;
        const rec = { name, from: idOf(id), estimateName: est.name, observedMonthly: (b.serviceCost || {}).monthly, block: clone(b) };
        // Lines without a description share a name across estimates (e.g. "amazonRoute53__default").
        // Every block is also kept as "<name>@<first 6 of estimate id>" so a spec can pick the exact variant.
        library[name + "@" + idOf(id).slice(0, 6)] = { ...rec, name: name + "@" + idOf(id).slice(0, 6) };
        if (newer) {
          library[name] = rec;
          loaded.push(name);
        }
      }
    }
    return { loaded: [...new Set(loaded)].sort(), total: Object.keys(library).length };
  }

  function findTemplate(ref) {
    if (library[ref]) return library[ref];
    const m = Object.keys(library).filter((k) => !k.includes("@") && (k === ref || k.startsWith(ref + "__")));
    if (m.length === 1) return library[m[0]];
    throw new Error(m.length ? `template '${ref}' is ambiguous: ${m.join(", ")}` : `no template '${ref}' in the library`);
  }

  // ---- live-schema field info (for fields a template does not carry) ----
  const fieldCache = {};
  async function rawSchema(code) {
    const m = window.__czManifest || (window.__czManifest = await (await fetch(CDN + "/manifest/en_US.json")).json());
    const entry = (m.awsServices || []).find((s) => (s.key || s.serviceCode) === code) || {};
    return (await fetch(CDN + (entry.serviceDefinitionUrlPath || `/data/${code}/en_US.json`))).json();
  }
  async function fieldInfo(code) {
    if (fieldCache[code]) return fieldCache[code];
    const def = await rawSchema(code);
    const info = {};
    const w = (n) => {
      if (Array.isArray(n)) return n.forEach(w);
      if (!n || typeof n !== "object") return;
      if (n.id && n.type === "input" && !["alert", "bodyText", "headerText"].includes(n.subType) && !info[n.id]) {
        const f = { type: n.subType || "input", label: n.label || "" };
        if (n.subType === "frequency") f.units = (n.options || []).map((o) => o.id);
        if (n.subType === "fileSize") {
          const sizes = (n.dropDownSize || []).map((o) => o.id || o.value);
          const freqs = n.outputFrequency && n.outputFrequency !== "NA" ? [(n.defaultOption || {}).frequency || "month"] : ["NA"];
          f.units = sizes.flatMap((s) => freqs.map((q) => `${s}|${q}`));
          if (n.defaultOption) f.defaultUnit = `${n.defaultOption.size}|${n.defaultOption.frequency}`;
        }
        if (n.subType === "durationInput") f.units = (n.dropDownDuration || []).map((o) => o.value || o.id);
        if (n.subType === "dropdown" && Array.isArray(n.options)) f.options = n.options.map((o) => o.id ?? o.value).filter((x) => x !== undefined);
        info[n.id] = f;
      }
      Object.values(n).forEach((v) => typeof v === "object" && w(v));
    };
    w(def.templates || def);
    return (fieldCache[code] = info);
  }
  // Load schema field info for every service a spec uses. Call before CZ.build(spec).
  async function prepare(spec) {
    const codes = new Set();
    for (const s of spec.services || []) {
      try {
        const t = findTemplate(s.template);
        codes.add(t.block.serviceCode);
        (t.block.subServices || []).forEach((x) => codes.add(x.serviceCode));
      } catch (e) { /* reported by build */ }
    }
    for (const c of codes) await fieldInfo(c);
    return [...codes];
  }

  function apply(holder, fid, v) {
    const cur = holder[fid];
    // columnFormIPM-style rows: an object (not array) merges into row 0
    if (cur && Array.isArray(cur.value) && v && typeof v === "object" && !Array.isArray(v) && !("value" in v) && cur.value[0] && typeof cur.value[0] === "object" && !("entryType" in cur.value[0])) {
      const row = cur.value[0];
      for (const [k, x] of Object.entries(v)) row[k] = x && typeof x === "object" && "value" in x ? x : { value: typeof x === "object" ? x : String(x) };
      return;
    }
    if (v && typeof v === "object" && !Array.isArray(v) && "value" in v) { holder[fid] = { ...(cur || {}), ...v }; return; }
    if (cur && typeof cur === "object" && "value" in cur) {
      if (cur.value && typeof cur.value === "object" && !Array.isArray(cur.value) && v && typeof v === "object" && !Array.isArray(v)) cur.value = { ...cur.value, ...v };
      else cur.value = typeof cur.value === "string" && typeof v !== "object" ? String(v) : v;
      return;
    }
    holder[fid] = { value: typeof v === "object" ? v : String(v) };
  }

  function build(spec) {
    const errors = [], warnings = [], report = [];
    const payload = {
      name: spec.name, services: {}, groups: {}, groupSubtotal: { monthly: 0, upfront: 0 },
      totalCost: { monthly: 0, upfront: 0 }, support: {},
      metaData: { locale: "en_US", currency: "USD", createdOn: new Date().toISOString(), source: "calculator-platform" },
    };
    const regions = new Set(spec.regions || []);
    const groupKeys = {};
    for (const s of spec.services || []) {
      let t;
      try { t = findTemplate(s.template); } catch (e) { errors.push(e.message); continue; }
      const b = clone(t.block);
      if (!s.region) errors.push(`${t.name}: region missing`);
      if (regions.size && !regions.has(s.region)) errors.push(`${t.name}: region ${s.region} is not a confirmed region`);
      if (!s.description) errors.push(`${t.name} (${s.region}): description missing`);
      if (!s.source) errors.push(`${t.name} (${s.region}): source missing`);
      for (const x of [b, ...(b.subServices || [])]) { x.region = s.region; x.description = s.description || null; }
      b.regionName = s.region; // calculator re-labels on load
      const h = holders(b);
      const written = [];
      if (s.model) { // Bedrock: pick the model by its calculator label, e.g. "Anthropic: Claude Sonnet 5"
        const prov = (b.subServices || [])[0] && b.subServices[0].serviceCode;
        const rec = (models[prov] || {})[s.model];
        if (!rec) errors.push(`${t.name}: model '${s.model}' unknown - run await CZ.bedrockModels('${prov}') first and use an exact label`);
        else {
          const all = { modelSelection: rec.modelSelection, ...rec.fields };
          for (const [fid, v] of Object.entries(all)) if (fid in h) { apply(h[fid], fid, v); written.push(fid); }
        }
      }
      for (const [fid, v] of Object.entries(s.set || {})) {
        // Dropdown values are checked against the live schema's option ids for template fields too
        // (e.g. Lambda architecture is "1", not "x86" - a wrong id silently hides dependent fields).
        const fiAny = [b, ...(b.subServices || [])].map((x) => fieldCache[x.serviceCode] && fieldCache[x.serviceCode][fid]).find(Boolean);
        if (fiAny && fiAny.options && fiAny.options.length && !(v && typeof v === "object") && !fiAny.options.map(String).includes(String(v))) {
          errors.push(`${t.name}: '${fid}' (${fiAny.label}) value '${v}' is not an option id; use one of: ${fiAny.options.slice(0, 20).join(", ")}`); continue;
        }
        if (fid in h) { apply(h[fid], fid, v); written.push(fid); continue; }
        // Not in the template: allowed only if the live schema has it, with a valid unit.
        const owners = [b, ...(b.subServices || [])].filter((x) => fieldCache[x.serviceCode] && fieldCache[x.serviceCode][fid]);
        if (!owners.length) {
          const loaded = [b, ...(b.subServices || [])].every((x) => fieldCache[x.serviceCode]);
          errors.push(`${t.name}: unknown field '${fid}'` + (loaded ? " (not in template or live schema)" : " - run await CZ.prepare(spec) before CZ.build"));
          continue;
        }
        const target = owners[owners.length - 1];
        const fi = fieldCache[target.serviceCode][fid];
        if (fi.units) {
          if (!(v && typeof v === "object" && "value" in v && "unit" in v)) { errors.push(`${t.name}: '${fid}' (${fi.label}) needs {value, unit}; unit one of: ${fi.units.join(", ")}`); continue; }
          if (fi.units.length && !fi.units.includes(v.unit)) { errors.push(`${t.name}: '${fid}' unit '${v.unit}' invalid; use one of: ${fi.units.join(", ")}`); continue; }
        }
        if (fi.options && fi.options.length && !(v && typeof v === "object") && !fi.options.map(String).includes(String(v))) {
          errors.push(`${t.name}: '${fid}' value '${v}' not an option; options: ${fi.options.slice(0, 20).join(", ")}`); continue;
        }
        target.calculationComponents = target.calculationComponents || {};
        target.calculationComponents[fid] = v && typeof v === "object" && "value" in v ? { ...v, value: String(v.value) } : { value: String(v) };
        written.push(fid);
        warnings.push(`${t.name}: '${fid}' (${fi.label}) added from live schema`);
      }
      const confirmed = new Set(s.confirm || []);
      const inherited = {};
      for (const [fid, holder] of Object.entries(holders(b))) if (!written.includes(fid) && !confirmed.has(fid)) inherited[fid] = val(holder[fid]);
      const key = `${b.serviceCode}-${crypto.randomUUID()}`;
      if (s.group) {
        if (!groupKeys[s.group]) {
          groupKeys[s.group] = `${s.group.replace(/\s+/g, "")}-${crypto.randomUUID()}`;
          payload.groups[groupKeys[s.group]] = { name: s.group, services: {}, groups: {}, totalCost: { monthly: 0, upfront: 0 } };
        }
        payload.groups[groupKeys[s.group]].services[key] = b;
      } else payload.services[key] = b;
      report.push({ template: t.name, region: s.region, description: s.description, set: written, inherited });
    }
    return { payload: zero(payload), report: { errors, warnings, services: report } };
  }

  // Price a payload with the calculator's own code, without saving anything.
  async function price(payload, timeoutMs = 30000) {
    const fakeId = hex(20);
    const body = JSON.stringify(zero(payload));
    const origFetch = window.__czOrigFetch || (window.__czOrigFetch = window.fetch);
    window.fetch = function (u, o) {
      const url = typeof u === "string" ? u : (u && u.url) || "";
      if (url.includes(fakeId)) return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/json" } }));
      return origFetch.apply(this, arguments);
    };
    try {
      location.hash = "#/estimate?id=" + fakeId;
      const t0 = Date.now();
      let last = null;
      while (Date.now() - t0 < timeoutMs) {
        await sleep(700);
        const raw = sessionStorage.getItem(STATE_KEY);
        if (!raw) continue;
        const st = JSON.parse(raw).estimate;
        if (!st || st.name !== payload.name) continue;
        const n = [...walk(st)].length;
        const expected = [...walk(payload)].length;
        const priced = [...walk(st)].every(({ b }) => b.serviceCost && typeof b.serviceCost.monthly === "number");
        const sig = JSON.stringify(st.totalCost);
        if (n === expected && priced && sig === last) return st; // stable for two polls
        last = sig;
      }
      throw new Error("calculator did not finish pricing within " + timeoutMs / 1000 + "s");
    } finally {
      window.fetch = origFetch;
    }
  }

  function lines(est) {
    return [...walk(est)].map(({ path, b }) => ({
      group: path.join(" / ") || "-", code: b.serviceCode, service: b.serviceName || b.serviceCode,
      region: b.region, description: b.description || "",
      monthly: +((b.serviceCost || {}).monthly || 0), upfront: +((b.serviceCost || {}).upfront || 0),
      subs: (b.subServices || []).map((s) => [s.serviceCode, +((s.serviceCost || {}).monthly || 0)]),
      summary: b.configSummary || "", version: b.version,
    }));
  }

  function compare(a, b) {
    const la = lines(a), lb = lines(b), out = [];
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
      const x = la[i], y = lb[i];
      if (!x || !y) { out.push({ line: i + 1, issue: "line missing", a: x && x.service, b: y && y.service }); continue; }
      const d = +(y.monthly - x.monthly).toFixed(2);
      if (Math.abs(d) >= 0.01 || Math.abs(y.upfront - x.upfront) >= 0.01)
        out.push({ line: i + 1, service: x.service, region: x.region, description: x.description, saved: x.monthly, now: y.monthly, diff: d,
                   subs: x.subs.map((s, j) => [s[0], s[1], (y.subs[j] || [])[1]]).filter((s) => s[1] !== s[2]) });
    }
    return out;
  }

  function check(est, spec, opts = {}) {
    const f = [], L = lines(est), byRegion = {};
    for (const { b } of walk(est)) (byRegion[b.region] = byRegion[b.region] || []).push(b);
    for (const [r, bs] of Object.entries(byRegion)) {
      const ec2s = bs.filter((b) => b.serviceCode === "ec2Enhancement" && +val(components(b).storageAmount) > 0);
      const ebs = bs.filter((b) => b.serviceCode === "amazonElasticBlockStore" && +val(components(b).storageAmount) > 0);
      if (ec2s.length && ebs.length) f.push({ level: "WARN", msg: `${r}: EBS volume storage is on the EC2 line and on a separate EBS line - likely priced twice.` });
      const codes = new Set(bs.map((b) => b.serviceCode));
      const compute = ["ec2Enhancement", "awsFargate", "amazonEKS", "awsLambda", "amazonECS"].some((c) => codes.has(c)) || [...codes].some((c) => /RDS|Aurora|ElastiCache|OpenSearch|DocumentDB/i.test(c));
      if (!compute && (codes.has("amazonVirtualPrivateCloud") || codes.has("elasticLoadBalancing")))
        f.push({ level: "WARN", msg: `${r}: networking but no compute in this region - possible region typo.` });
    }
    const copies = {};
    for (const { b } of walk(est)) (copies[b.serviceCode + "|" + (b.description || "").toLowerCase()] = copies[b.serviceCode + "|" + (b.description || "").toLowerCase()] || []).push(b);
    for (const [k, bs] of Object.entries(copies)) {
      if (bs.length < 3) continue;
      const filled = bs.map((b) => new Set(Object.entries(components(b)).filter(([, v]) => { const x = val(v); return x !== "" && x !== null && x !== "0" && x !== 0 && !(Array.isArray(x) && !x.some((r) => r && r.value)); }).map(([id]) => id)));
      bs.forEach((b, i) => {
        const miss = [...new Set(filled.flatMap((s) => [...s]))].filter((id) => !filled[i].has(id) && filled.filter((s) => s.has(id)).length > bs.length / 2);
        if (miss.length) f.push({ level: "WARN", msg: `${k.split("|")[0]} in ${b.region} lacks ${miss.join(", ")} that most copies set - inconsistent copy?` });
      });
    }
    for (const l of L) {
      if (l.monthly === 0 && l.upfront === 0 && !FREE_OK.has(l.code)) f.push({ level: "FAIL", msg: `${l.service} (${l.region}, '${l.description}') priced at 0.00 - inputs not recognised.` });
      for (const [sc, m] of l.subs) if (m === 0 && l.subs.length > 1) f.push({ level: "WARN", msg: `${l.service} (${l.region}): sub-service ${sc} is 0.00.` });
    }
    const unnamed = L.filter((l) => !l.description);
    if (unnamed.length) f.push({ level: "WARN", msg: `${unnamed.length} line(s) have no description.` });
    // Template values that are costly by default or look idle
    for (const { b } of walk(est)) {
      const c = components(b), where = `${b.serviceName || b.serviceCode} (${b.region}, '${b.description || ""}')`;
      if (/RDS|Aurora/i.test(b.serviceCode)) {
        if (val(c.storageVolume) === "General Purpose") f.push({ level: "WARN", msg: `${where}: storage is gp2 - use gp3 ("General Purpose-GP3") unless the input says gp2.` });
        // RDS Proxy + Database Insights added 172.28 USD/month on 2x db.r6g.xlarge Multi-AZ (16 Oct 2026).
        // Extended Support "1" priced 0 extra in the same test, so it is not flagged.
        for (const [id, what] of [["createRDSProxy", "RDS Proxy"], ["DatabaseInsightsSelected", "Database Insights"]])
          if (String(val(c[id])) === "1") f.push({ level: "WARN", msg: `${where}: ${what} is on (the form switches it on by default) - keep only if the client needs it.` });
      }
      if (b.serviceCode === "elasticLoadBalancing") {
        const alb = (b.subServices || []).find((s) => s.serviceCode === "applicationLoadBalancer");
        const p = alb && (alb.calculationComponents || {}).sizeOfDataProcessedForEC2InstanceAndIPAddressTargets;
        const gbh = p ? +val(p) / (/month/.test(p.unit || "") ? 730 : 1) : 0;
        if (alb && gbh < 2) f.push({ level: "WARN", msg: `${where}: ALB processes ${gbh.toFixed(2)} GB/hour - priced at little more than the hourly charge. Set processed bytes and connections from the expected traffic.` });
      }
    }
    const total = L.reduce((s, l) => s + l.monthly, 0);
    if (opts.budget != null && total > opts.budget) f.push({ level: "FAIL", msg: `Monthly ${total.toFixed(2)} USD is over the ${opts.budget} USD budget.` });
    // MRR CC: land on the target, spread over the core platform, baseline present
    if (opts.target != null) {
      const tol = opts.targetTolerance ?? 0.01, off = (total - opts.target) / opts.target;
      if (Math.abs(off) > tol) f.push({ level: "FAIL", msg: `Monthly ${total.toFixed(2)} USD is ${(off * 100).toFixed(1)}% from the ${opts.target} USD MRR target (tolerance ±${tol * 100}%).` });
      const top = L.reduce((a, l) => (l.monthly > a.monthly ? l : a), { monthly: 0 });
      if (total && top.monthly / total > 0.5) f.push({ level: "WARN", msg: `${top.service} '${top.description}' is ${Math.round((top.monthly / total) * 100)}% of the total. Check it is a service the task really runs, not filler to reach the MRR.` });
    }
    const excluded = (spec && spec.exclude) || {};
    const present = new Set(L.map((l) => l.code));
    for (const code of opts.require || []) if (!present.has(code) && !excluded[code])
      f.push({ level: "FAIL", msg: `Baseline service ${code} is missing. Add it, or put it in spec.exclude with the user's reason.` });
    if (spec && spec.services && spec.services.length !== L.length) f.push({ level: "FAIL", msg: `Spec has ${spec.services.length} lines, estimate has ${L.length}.` });
    if (spec && spec.services) {
      spec.services.forEach((s) => {
        if (s.expect_monthly == null) return;
        const l = L.find((x) => x.region === s.region && x.description === s.description);
        if (l && Math.abs(l.monthly - s.expect_monthly) / Math.max(s.expect_monthly, 0.01) > (opts.tolerance || 0.02))
          f.push({ level: "FAIL", msg: `${l.service} '${l.description}': ${l.monthly} vs expected ${s.expect_monthly}.` });
      });
    }
    return f;
  }

  async function save(est) {
    const body = clone(est);
    delete (body.metaData || {}).estimateId;
    const r = await (window.__czOrigFetch || fetch)(SAVE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const outer = await r.json();
    const inner = typeof outer.body === "string" ? JSON.parse(outer.body) : outer;
    if (!inner.savedKey) throw new Error("save failed: " + JSON.stringify(outer).slice(0, 300));
    return { id: inner.savedKey, url: "https://calculator.aws/#/estimate?id=" + inner.savedKey };
  }

  async function schemaFields(code) {
    const m = window.__czManifest || (window.__czManifest = await (await fetch(CDN + "/manifest/en_US.json")).json());
    const entry = (m.awsServices || []).find((s) => (s.key || s.serviceCode) === code) || {};
    const def = await (await fetch(CDN + (entry.serviceDefinitionUrlPath || `/data/${code}/en_US.json`))).json();
    const out = [], seen = new Set();
    const w = (n) => {
      if (Array.isArray(n)) return n.forEach(w);
      if (!n || typeof n !== "object") return;
      if (n.id && (n.type || n.subType) && !seen.has(n.id) && !["bodyText", "headerText", "alert"].includes(n.subType || n.type)) {
        seen.add(n.id);
        const o = { id: n.id, type: n.subType || n.type, label: n.label || "" };
        if (n.options) o.options = n.options.map((x) => x.value ?? x.id);
        out.push(o);
      }
      Object.values(n).forEach((v) => typeof v === "object" && w(v));
    };
    w(def.templates || def);
    return { code, version: def.version, fields: out };
  }

  // Add the blocks of whatever estimate is open in the calculator right now (nothing is saved).
  // Use after configuring a service by hand in the calculator UI ("Save and add service").
  function harvestCurrent() {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) throw new Error("no estimate open in this tab");
    const est = JSON.parse(raw).estimate;
    const added = [];
    for (const { b } of walk(est)) {
      const name = templateName(b);
      library[name] = { name, from: "page:" + (est.name || ""), estimateName: est.name, observedMonthly: (b.serviceCost || {}).monthly, block: clone(b) };
      added.push(name);
    }
    return added;
  }

  // Add a service with no template: drive the calculator UI (search -> Configure -> Save and view summary),
  // then harvest the saved block into the library. Nothing is published. The form may be saved nearly empty;
  // CZ.build fills the real values from the spec (fields added from the live schema).
  //   await CZ.addService("Step Functions", "AWS Step Functions")   // search text, exact Configure-button name
  async function addService(searchText, serviceName, description) {
    const desc = description || "lib " + serviceName;
    const setVal = (el, v) => { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value"); d.set.call(el, v); ["input", "change", "blur"].forEach((e) => el.dispatchEvent(new Event(e, { bubbles: true }))); };
    location.hash = "#/addService";
    let box; for (let i = 0; i < 30 && !box; i++) { await sleep(300); box = document.querySelector('input[placeholder="Search for a service"]'); }
    if (!box) throw new Error("addService: search box not found");
    setVal(box, searchText); await sleep(1200);
    const choices = [...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") || "").filter((t) => t.startsWith("Configure "));
    const btn = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "") === "Configure " + serviceName);
    if (!btn) throw new Error(`addService: no '${serviceName}'. Search '${searchText}' offers: ${choices.slice(0, 8).map((c) => c.slice(10)).join(" | ")}`);
    btn.click();
    let d; for (let i = 0; i < 40 && !d; i++) { await sleep(300); d = document.querySelector('input[placeholder="Enter a description for your estimate"]'); }
    if (!d) throw new Error("addService: form did not open");
    await sleep(2500);
    setVal(d, desc); await sleep(300);
    const saveBtn = () => [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Save and view summary");
    saveBtn().click();
    for (let i = 0; i < 10 && !location.hash.startsWith("#/estimate"); i++) await sleep(300);
    if (!location.hash.startsWith("#/estimate")) { // some forms need one value before saving
      const empty = [...document.querySelectorAll('input[type="number"], input[type="text"]')].find((x) => !x.value && /Value|Number|requests|Storage|Pages/i.test(x.getAttribute("aria-label") || ""));
      if (empty) { setVal(empty, "1"); await sleep(1000); saveBtn().click(); }
      for (let i = 0; i < 15 && !location.hash.startsWith("#/estimate"); i++) await sleep(300);
    }
    if (!location.hash.startsWith("#/estimate")) throw new Error(`addService: '${serviceName}' form would not save - configure it by hand once, then CZ.harvestCurrent()`);
    await sleep(800);
    return harvestCurrent().filter((n) => n.endsWith("__" + slug(desc)));
  }

  // Bedrock: model label -> every dropdown value that model implies (modelSelection plus the
  // dependent selectedModel / _od / cache / per-route fields). Cached in CZ.models[provider].
  const models = {};
  async function bedrockModels(provider = "anthropic") {
    if (models[provider]) return models[provider];
    const m = window.__czManifest || (window.__czManifest = await (await fetch(CDN + "/manifest/en_US.json")).json());
    const entry = (m.awsServices || []).find((s) => (s.key || s.serviceCode) === provider) || {};
    const def = await (await fetch(CDN + (entry.serviceDefinitionUrlPath || `/data/${provider}/en_US.json`))).json();
    const out = {};
    const w = (n, parent) => {
      if (Array.isArray(n)) return n.forEach((x) => w(x, parent));
      if (!n || typeof n !== "object") return;
      if (n.id && n.label && n.displayIf && parent) {
        const rec = (out[n.label] = out[n.label] || { modelSelection: null, fields: {} });
        if (n.displayIf.exists && n.displayIf.exists.meteredUnit === n.id && parent.id === "modelSelection") rec.modelSelection = n.id;
        const eq = n.displayIf["=="];
        if (Array.isArray(eq) && eq[0] && eq[0].id === "modelSelection") { rec.fields[parent.id] = n.id; rec.modelSelection = rec.modelSelection || eq[1]; }
      }
      const isComp = n.id && (n.type || n.subType);
      Object.values(n).forEach((v) => typeof v === "object" && w(v, isComp ? n : parent));
    };
    w(def, null);
    for (const k of Object.keys(out)) if (!out[k].modelSelection) delete out[k];
    return (models[provider] = out);
  }

  // Undo any earlier fetch patching on this page (e.g. an aborted price()).
  if (!window.__czOrigFetch) {
    const f = document.createElement("iframe");
    f.style.display = "none";
    document.body.appendChild(f);
    window.__czOrigFetch = f.contentWindow.fetch.bind(window);
  }
  window.fetch = window.__czOrigFetch;

  // Services every MRR CC carries unless the user excludes one (references/mrr_cc.md).
  const MRR_BASELINE = ["awsFargate", "amazonElasticContainerRegistry", "awsCodePipeline", "awsCodeBuild",
    "amazonSimpleStorageServiceGroup", "elasticLoadBalancing", "amazonVirtualPrivateCloud", "amazonRoute53",
    "awsSecretsManager", "awsKeyManagementService", "amazonCloudWatch", "awsCloudTrail", "amazonRDSPostgreSQLDB",
    "awsBackup", "awsWebApplicationFirewall"];

  window.CZ = { read, loadLibrary, library, findTemplate, harvestCurrent, addService, bedrockModels, models, fieldInfo, prepare, build, zero, price, lines, compare, check, save,
                schemaFields, templateName, MRR_BASELINE, walk: (e) => [...walk(e)] };
  return "CZ engine ready";
})();
