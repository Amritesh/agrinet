# AGRINET 3.0 — Research Brief

Status: evidence-grounded desk research, compiled 2026-11-07. Every external claim carries an inline `[n]` that points to a page fetched into `logs/research-cache/`. Each cited source has at least one verbatim quote attached in `logs/research-sources.json`. A claim without a fetched source is marked `[unverified]`. AGRINET design conclusions are labelled **Design note**. They are our own reasoning, not sourced facts.

Ledger: `logs/research-sources.json` · Fetch log: `logs/research-retrievals.json` · Rebuild: `bash logs/research-cache/build_ledger.sh`

---

## (a) Onion / tomato / potato (TOP) supply chain in India

### What the sources say

- An RBI working paper on TOP price dynamics estimates the farmers' share in the consumer rupee at around 33 per cent for tomato, 36 per cent for onion and 37 per cent for potato.[1]
- The same paper calls TOP markets highly fragmented. State APMCs fix mandi fees, official commission charges and user charges. The paper attributes the weak value chain to perishability, regional and seasonal concentration, inadequate storage and a large number of intermediaries.[1]
- **Tomato (supply regions → Delhi).** Farmers receive on average 33.5 per cent of the consumer's price in Delhi.[1]
  - This figure includes the farmers' labour and transport overheads.[1]
  - Traders' mark-up is 21.3 per cent. It includes transport, mandi fees, commission and loading charges, and leaves about a 5.3 per cent trader margin.[1]
  - The retailer takes the highest margin.[1]
- **Onion (Nashik and other states → Delhi).** Farmers receive on average 36.2 per cent of the consumers' rupee.[1]
  - Traders' mark-up is 17.6 per cent and wholesalers' 15.0 per cent. The retailer's mark-up is 31.3 per cent.[1]
  - At the primary APMC, the commission agent pays mandi fees (1 per cent), commission charges (4 per cent) and loading/unloading charges (₹ 9.02 per quintal).[1]
  - Primary traders then deal with traders and wholesalers in secondary mandis such as Azadpur. Either party pays transport of about ₹ 240 per quintal.[1]
- **Potato (Agra → Mumbai).** Farmers receive 36.7 per cent of the consumer rupee, including transport costs.[1]
  - Farmers usually sell to village-level aggregators or traders. They also store in cold stores between March and November, at about ₹ 250–260 per quintal.[1]
  - Cold storages are the most important selling point in the western UP potato belt. Open auctions take place at the cold store, with the owner mediating between farmer and trader.[1]
  - Farmers also borrow from cold-store owners at high interest.[1]
  - Contract-farming growers sell directly to processors; the paper names PepsiCo, Balaji and Haldirams.[1]
- **Method caveat.** The RBI farmer price is a weighted wholesale price (Agmarknet / mandi), used as a farm-gate proxy. Other costs come from field visits.[1] These are therefore point estimates for specific corridors and periods, not national constants.
- FAO's marketing-management text treats "farmer's share" and the "farm-retail price spread" as reciprocal measures of the same margin.[29]

### Participants and the four flows

The roles below are synthesised from [1] where cited. All other cells are general domain knowledge marked [unverified]. The local term *arhatiya* for commission agent is not used in the fetched sources.[unverified]

| Participant | Produce | Ownership | Money | Information |
|---|---|---|---|---|
| Farmer / FPO | Does the first sorting and grading at the farm gate, then takes produce to the mandi[1] | Owns the produce until the auction or private sale[1] | Bears labour and transport overheads to the mandi[1] | Learns prices at the auction and from mandi peers [unverified] |
| Village aggregator | Buys potato at the village level[1] | Takes title [unverified] | Pays the farmer, often in cash [unverified] | Informal [unverified] |
| Commission agent | Facilitates the auction for the buyer[1] | Usually does not take title [unverified] | Pays mandi fee (1%) and commission (4%) on onion[1] | Intermediates price discovery [unverified] |
| APMC mandi | Physical auction venue; open auction for onion[1] | No ownership | Levies fees set by the state APMC[1] | Arrivals and prices feed Agmarknet / data.gov.in[2] |
| Licensed trader | Buys at the auction[1] | Takes title[1] | Pays fees, commission and transport[1] | Holds e-NAM trader login after APMC licence check[7] |
| Secondary wholesaler (e.g., Azadpur) | Receives inter-state lots[1] | Takes title[1] | Earns 15.0% mark-up on onion[1] | n/a |
| Cold store | Stores potato from March to November[1] | Farmer usually keeps title [unverified] | Charges ₹ 250–260/qtl; also lends to farmers[1] | Venue for auctions[1] |
| Warehouse (WDRA-registered) | Stores the goods | Depositor holds the eNWR[9] | Receipt can be pledged for loans[10] | Repository is the single source of truth[10] |
| Processor | Procures directly or from mandis[1] | Takes title | Contract-farming payments[1] | n/a |
| Retailer / retail DC | Final sale | Takes title | Highest margin share[1] | Retail DC flows not covered by fetched sources [unverified] |
| Institutional buyer | Not covered by fetched sources [unverified] | — | — | — |
| Transporter | ~₹ 240/qtl Nashik→Delhi (onion)[1] | Carrier, not owner [unverified] | Paid by the trader or wholesaler[1] | n/a |
| Exporter | Onion is exported; restrictions cut the export share to 5% in TE 2021-22[1] | Takes title | n/a | APEDA HortiNet holds traceability and QA data for onion exports[28] |

**Design note.** AGRINET must model ownership transfer separately from physical movement. In the potato chain, for example, a cold store can host an auction without owning the stock.[1]

---

## (b) AGMARKNET modal prices: reported observations, not executable quotes

- The OGD dataset generated through the AGMARKNET portal publishes the daily wholesale maximum price, minimum price and modal price.[2]
- The price-statistics manual defines the modal price as the price at which the majority of the day's transactions take place.[3]
- The manual says such figures describe prices actually agreed for completed transactions. They are not prices asked for or offered before the transactions are completed.[3]
- The manual also warns that a modal price can mislead as an average when a few large lots trade at a different price. This happens because the modal reflects transaction count, not volume.[3]
- FAO recommends "Fair Average Quality" (FAQ) as the basis for price reporting.[3] The manual further notes that the modal price can refer to the most commonly traded variety and quality.[3]
- AGMARKNET's own "About us" page could not be fetched (see Retrieval failures). The following are therefore [unverified]:
  - that AGMARKNET's unit is ₹/quintal;
  - that each row carries a variety/grade label;
  - that FAQ grading is applied uniformly across mandis.

**Design note: consequences for AGRINET.**
1. Store AGMARKNET values as `ReportedPriceObservation` with `{market, date, commodity, variety, grade, unit, min, max, modal, source}`. Never store them as a bid, offer or quote.
2. Do not compute volume-weighted averages from the modal price. Flag a low-arrival day as low confidence.
3. Treat cross-market spreads as indicative only. Grade differences matter: Delhi onion is described as 'A' grade, which fetches the highest price.[1]
4. Any executable price must come from a counterparty quotation workflow. It must be tracked with a source, a validity window and a quantity.

---

## (c) e-NAM, WDRA warehouse receipts, cold-storage standards

### e-NAM
- e-NAM is a pan-India electronic trading portal. It networks existing APMC mandis into a unified national market.[8]
- PIB reports 1,656 mandis integrated across 23 States and 4 UTs by March 2026.[4]
- The portal covers gate entry, lot creation, quality assaying, online bidding and direct e-payment to farmers' bank accounts.[4] It supports NEFT, RTGS, internet banking and UPI.[4]
- **Logistics:**
  - The FPO trade module, Logistics module and eNWR-based Warehouse module were launched on 2 April 2020.[5]
  - The Platform of Platforms (PoP) exposes services including logistics, warehousing, quality assurance, grading and packaging.[4]
- The revised operational guidelines (Oct 2023) prioritise Warehouse Based Sale and eNWR trade through e-NAM.[6]
- **Registration:** farmers receive a permanent login after APMC approval.[7] Traders verify their licence number at their mandi/APMC.[7]
- The trading-details page failed TLS verification and was not used. Live e-NAM trade data and API terms are [unverified].

### WDRA electronic negotiable warehouse receipts (eNWR)
- Under the WDRA eNWR Regulations 2017, registered warehouses must issue eNWRs only through a WDRA-registered repository.[9]
- The WDRA model SOP names the repository as the single source of information for an eNWR.[10] It covers deposit, pledge and delivery, including eNAM trade.[10]
- e-NWR is integrated with e-NAM.[4]
- Whether perishable onion or potato lots are routinely eligible for eNWR is [unverified].

### NHB / NCCD cold-storage standards
- NCCD's 2025 engineering guidelines define a dedicated "CS-1-Onion" cold-store type for single-product, bulk, long-term onion storage.[11]
- The guidelines give these storage conditions:[11]

  | Produce | Temperature | Relative humidity | Holding time |
  |---|---|---|---|
  | Onion | 1–3°C | 60–65% | 4–6 months |
  | Late potato | 4–12°C | 90–95% | 5–10 months |

- NCCD also notes that cold stores were initially used mostly for potatoes.[11]
- NHB lists technical standards for cold storages for fruits and vegetables.[12] Its potato note advises spreading potatoes on shelves to no more than 30 cm thickness.[13]

**Design note.** A `StorageQuote` must carry the facility type (e.g., CS-1-Onion) and the declared temperature/RH band. That lets AGRINET flag a mismatch between commodity and facility. The facility type must not be inferred from a facility's name.

---

## (d) International precedents

- **USDA AMS Market News.**
  - Shipping-point reports give prices at which specialty crops traded. Each price is differentiated by origin, variety, size, package and grade.[15]
  - The National FOB Review states that its prices represent open (spot) market sales by first handlers.[14] It also states that the Delivered Sales, Shipping Point Basis excludes all charges for freight.[14]
  - Terminal-market reports such as Asheville AS_FV020 publish commodity ranges by package and origin.[16]
  - The methodology landing page on MyMarketNews could not be fetched, so detailed collection methodology is [unverified].
- **FAO GIEWS FPMA.**
  - The FPMA Tool is available to countries and regional organisations.[17]
  - FPMA provides early warning on high food prices at country level.[18]

**Design note.** These precedents point AGRINET toward four reporting rules:
1. Publish ranges plus a "mostly" figure, not a single number.
2. Label the price basis: FOB shipping point, delivered or terminal market.
3. State explicitly whether freight is included.
4. Never mix grades within one series.

---

## (e) Routing and freight providers

### Evaluation matrix

| Provider | India coverage | Truck routing | Tolls | Freight rates | API access | Licensing | Quotas | Cost |
|---|---|---|---|---|---|---|---|---|
| OSRM public demo | Runs "worldwide" profiles[20] | No; demo profiles are car, foot and bike[20] | not verified | No | Public HTTP; must not sit behind a paywall[19] | ODbL attribution required[19] | ≤1 req/s; reasonable non-commercial use[20] | Free; no guarantees[19] |
| OSRM self-hosted | Depends on OSM extract (not verified for India quality) | Custom Lua profile possible (not verified) | not verified | No | Own server | OSM ODbL (not verified) | Own capacity | Infrastructure cost (not verified) |
| Valhalla | not verified | Truck costing checks access, width, height and weight[21] | `use_tolls` preference; toll-booth cost/penalty in seconds, not money[21] | No | Self-host or hosted (not verified) | not verified | not verified | not verified |
| Google Routes API | Coverage listed by country; India rows not captured[25] | Large-vehicle routing for a limited set of customers, by request[22] | Toll estimates in select cities, billed at a higher rate; non-commercial vehicle price[23]. Truck toll prices unsupported[22] | No | Yes | Google ToS (not verified) | Standard QPS limits[22] | Compute Routes Essentials: 10,000 free/month, then $5.00 → $0.38 per 1000 events by tier[24] |
| HERE Routing v8 | not verified | `transportMode=truck` with vehicle parameters[27] | not verified | No | Yes | not verified | not verified | not verified |
| BlackBuck (freight marketplace) | India; described as "India's largest trucking platform" in an AWS blog[26] | n/a | Offers FASTag services[26] | Marketplace pricing exists[26]; public rate API not verified | not verified | not verified | not verified | not verified |
| Other Indian freight marketplaces | not verified | not verified | not verified | not verified | not verified (truckzzy.com/api not retrievable) | not verified | not verified | not verified |

Additional notes on the matrix:
- **Google pricing.** The Pro and Enterprise SKUs are priced higher than Essentials.[24] The Essentials figures come from the Essentials SKU row of the published table. Which SKU a truck request is billed under is not verified.
- **BlackBuck.** The AWS blog is a vendor case study, not an API document.

### Strict type distinction (Design note)

| Type | Meaning | Is it a price someone will honour? | Required provenance |
|---|---|---|---|
| `RoutingProvider` | Returns geometry, distance and duration; may also return a toll *estimate* | No | Provider, profile (car/truck), data version |
| `FreightEstimate` | Model output: e.g., ₹/km × distance, or a reference such as RBI's ~₹ 240/qtl Nashik→Delhi[1] | No; indicative only | Model or source, date, assumptions |
| `FreightQuote` | Offer from an identified carrier or broker for lane, vehicle, date and load | Yes, within its validity window | Counterparty, quote ID, validity, terms |
| `Toll` | Toll charge on a route | Only when sourced from an operator or tariff. Google's estimate is for non-commercial vehicles[23]; Valhalla tolls are time penalties[21] | Source, vehicle class, date |
| `StorageQuote` | Rate offered by a cold store or warehouse for commodity, period and quantity | Yes, if issued by the facility | Facility, type (e.g., CS-1-Onion[11]), validity |
| `MarketFee` | Statutory or customary mandi charges (e.g., onion fee 1%, commission 4%, as reported for one corridor[1]) | Rules-based, state-specific | State, APMC, effective date, source |

Two rules follow from the table:
- Never promote an estimate to a quote, and never sum mixed types into a "landed cost" without labelling each component's type.
- A routing duration is not a freight cost.

---

## (f) Monetization hypotheses (no customers, prices, conversion or WTP are claimed)

Every hypothesis below is untested. "Alternatives" describes categories of existing practice, not named competitors with verified features.

1. **Market-intelligence subscription**
   - Target: traders, FPOs, processors (hypothesis).
   - Pain: modal prices are noisy and grade-ambiguous, and they cannot be executed (§b).
   - Alternatives: free AGMARKNET/e-NAM dashboards; phone networks.
   - Data needs: AGMARKNET/OGD feed[2], arrivals, grade metadata.
   - Validate: Do users act on modal prices today? What error tolerance do they accept? Is grade labelling the blocker?
2. **Logistics analytics**
   - Target: traders moving inter-state lots; FPOs.
   - Pain: transport is a material share of the mark-up[1], and lane rates are opaque.
   - Alternatives: broker calls; freight marketplaces[26].
   - Data needs: routing (§e), FreightQuote history, tolls.
   - Validate: Will carriers share quotes? How stable are lane rates? Can AGRINET legally use the routing data?
3. **Procurement optimisation**
   - Target: processors, retail chains, institutional buyers.
   - Pain: choosing between source mandis and cold stores under quality and freight uncertainty.
   - Alternatives: in-house buyers; spreadsheets.
   - Data needs: prices by grade, StorageQuote, FreightQuote, MarketFee.
   - Validate: Who owns the sourcing decision? How often are sources switched? What evidence would they trust?
4. **Data/API access**
   - Target: agri-fintechs, insurers, platforms.
   - Pain: they need cleaned, provenance-tagged mandi series.
   - Alternatives: raw OGD API[2]; direct scraping.
   - Data needs: normalised series with source and licence terms.
   - Validate: Does the OGD licence allow redistribution (not verified)? What SLA do buyers need?
5. **Warehouse/cold-store intelligence**
   - Target: cold-store operators, FPOs, lenders.
   - Pain: storage decisions and pledge finance depend on price outlook and facility suitability[1][10].
   - Alternatives: owner judgement; informal credit from cold-store owners[1].
   - Data needs: facility type and standards[11], eNWR status[9], price curves.
   - Validate: Will operators share occupancy? Do lenders use eNWR for perishables?
6. **Risk analytics**
   - Target: lenders, insurers, government monitors.
   - Pain: TOP price volatility[1].
   - Alternatives: RBI/FAO publications[1][18].
   - Data needs: long price history, arrivals, weather.
   - Validate: Which decision would a signal change? What lead time and accuracy are needed?
7. **Quotation workflow**
   - Target: any buyer or seller pair using AGRINET.
   - Pain: no executable price exists in public data (§b).
   - Alternatives: phone/WhatsApp; e-NAM bidding[4].
   - Data needs: counterparty identity, validity, audit trail.
   - Validate: Will counterparties issue time-bound quotes in-app? What dispute process do they need?

---

## Retrieval failures

The retrieval pass made 44 attempts and 39 succeeded. Two of the successes are also failures in substance: they returned only navigation. All failures are logged in `logs/research-retrievals.json`.

| URL | Failure | Effect |
|---|---|---|
| https://agmarknet.gov.in/aboutus | JS-rendered; 13 chars of text | AGMARKNET unit/grade claims marked [unverified] |
| https://www.enam.gov.in/web/trading-details | TLS verify error (curl rc=60) | Live trade data not used |
| https://mymarketnews.ams.usda.gov/node/8570 | curl rc=92 (HTTP/2), then timeout (rc=28) with `--http1.1` | AMS methodology page unverified; used AMS report PDFs instead |
| https://dfpd.nic.in/wdraNew.htm | DNS failure (rc=6) | Used WDRA regulations PDF and SOP instead |
| https://www.truckzzy.com/api | JS-rendered; 55 chars | Indian freight-marketplace API terms not verified |
| dfpd.gov.in WDRA pages; enam.gov.in traders page | Fetched (HTTP 200) but navigation only | Not cited |
| Google Routes coverage page | Fetched, but country table not in extracted text | India toll/two-wheeler coverage not verified |

**Not attempted:**
- Google Maps Platform terms of service.
- Valhalla hosted-service pricing.
- OGD data licence.
- Indian freight marketplaces other than BlackBuck.

## Sources

[1] https://www.rbi.org.in/Scripts/PublicationsView.aspx?id=22723 — RBI Working Paper: Price Dynamics of Tomato, Onion and Potato (TOP)
    > "The farmers’ share in the consumer rupee is estimated at around 33 per cent for tomato, 36 per cent for onion and 37 per cent for potato."
    > "tomato farmers on an average receive 33.5 per cent of the consumer’s price in Delhi"
    > "farmers on an average receive 36.2 per cent of the consumers’ rupee which includes cultivation and overhead costs."
    > "farmers receive a share of 36.7 per cent of the consumer rupee (Chart 20)."
    > "Cold storages are the most important selling point for farmers in the potato belt of western Uttar Pradesh."
    > "Potato farmers generally sell their produce to village level aggregators or traders."
    > "who pay the mandi fees (1 per cent), commission charges (4 per cent) and loading/unloading charges (₹ 9.02 per quintal)."
[2] https://data.gov.in/catalog/current-daily-price-various-commodities-various-markets-mandi — OGD India: Current daily price of various commodities from various markets (Mandi)
    > "It has the wholesale maximum price, minimum price and modal price on daily basis."
[3] http://www.agritech.tnau.ac.in/ta/amis_ta/pdf/rs/Manual_Agricultural_Prices_Marketing.pdf — Draft Manual on Agricultural Prices and Marketing (TNAU Agritech copy)
    > "the price at which the majo rity of the day's transactions take place"
    > "not prices asked for, or offered, in advance of the transactions being completed"
    > "FAO recommends that the concept of "Fair Average Quality" should be used as the basis for price reporting."
[4] https://www.pib.gov.in/PressReleasePage.aspx?PRID=2251543 — PIB: e-NAM progress and features (2026)
    > "1,656 mandis integrated across 23 States and 4 Union Territories by March 2026."
    > "including logistics, warehousing, quality assurance, grading and packaging"
    > "The platform integrates multiple digital payment modes, including NEFT, RTGS, internet banking, and UPI"
    > "the Electronic Negotiable Warehouse Receipt (e-NWR) system has been integrated with e-NAM"
[5] https://pib.gov.in/PressReleasePage.aspx?PRID=1622906 — PIB: e-NAM FPO, Logistics and eNWR modules (May 2020)
    > "FPO trade module, Logistics module and eNWR based Warehouse module were launched by the Union Agriculture Minister on 2nd April 2020."
[6] https://agriwelfare.gov.in/sites/default/files/Revised_eNAM_guidelines_Oct2023.pdf — Revised e-NAM Operational Guidelines (Oct 2023)
    > "to focus on Warehouses Based Sale (WBS) and eNWR trade through e-NAM;"
[7] https://enam.gov.in/resources/registration-guideline — e-NAM Registration Guidelines
    > "Once approved by APMC, you will receive eNAM Farmer Permanent Login ID"
    > "visit your respective Mandi/APMC and verify your License Number."
[8] https://enam.gov.in — e-NAM home
    > "National Agriculture Market (eNAM) is a pan-India electronic trading portal which networks the existing APMC mandis to create a unified national market for agricultural commodities."
[9] https://dfpd.gov.in/WriteReadData/NotificationUploadDocuments/1_360_1_WDandRA_Electronic_Negotiable_Warehouse_Receipts_Regulations_2017.pdf — WDRA (Electronic Negotiable Warehouse Receipts) Regulations, 2017
    > "shall issue electronic negotiable warehouse receipts only through a repository."
[10] https://website.wdra.gov.in/documents/20143/141296131/eNWR+%26+eNAM+process+.pdf/e17528f5-d089-9ec3-158c-78e020b7fa70 — WDRA Model SOP: Deposit, Pledge and Delivery of eNWRs and eNAM
    > "The single source of information for the eNWR will be the Repository;"
[11] https://nccd.gov.in/uploads/ENGINEERING_GUIDELINES_and_MINIMUM_SYSTEM_STANDARDS_FOR_IMPLEMENTATION_IN_COLD_CHAIN_COMPONENTS_2025_3a1cfb0b0a.pdf — NCCD Engineering Guidelines & Minimum System Standards for Cold Chain Components (2025)
    > "21 Onion 1-3°C 60-65% 4-6 months"
    > "1 Potato (late) 4-12°C 90-95% 5-10 Months"
    > "Initially cold stores were majorly used for storing potatoes"
    > "Definition: Cold Storage type –I -Onion (CS-1- Onion) are cold storages designed for single"
[12] https://www.nhb.gov.in/guidelines/cold-storage-guidelines.html — NHB cold storage guidelines index
    > "Technical Standards for Cold Storages for Fruits and Vegetables (Uploaded on 9.1.2010)"
[13] https://nhb.gov.in/pdf/vegetable/potato/pot009.pdf — NHB: Potato storage
    > "Potatoes in the cold storage are spread over the shelf to a thickness of not more than 30 cm."
[14] https://www.ams.usda.gov/mnreports/fvdfob.pdf — USDA AMS National FOB Review (FVDFOB)
    > "Prices represent open (spot) market sales by first handlers on"
    > "Delivered Sales, Shipping Point Basis excludes all charges for freight."
[15] https://www.ams.usda.gov/market-news/fruit-and-vegetable-shipping-point-market-price-reports — USDA AMS Specialty Crops Shipping Point Market Price Reports
    > "Prices are differentiated by the commodities’ growing origin, variety, size, package and grade."
[16] https://www.ams.usda.gov/mnreports/as_fv020.pdf — USDA AMS Asheville Terminal Market Vegetables Prices
    > "Asheville, NC Terminal Market Vegetables Prices (AS_FV020)"
[17] https://www.fao.org/giews/food-prices/price-tool/en — FAO GIEWS: About FPMA Tool
    > "The FPMA Tool is available to countries and regional organizations."
[18] https://www.fao.org/giews/food-prices/home/en — FAO GIEWS FPMA home
    > "It provides early warning on high food prices at country level"
[19] https://github.com/Project-OSRM/osrm-backend/wiki/API-Usage-Policy — OSRM API Usage Policy
    > "Excessive use is not allowed. If your requests are impacting the service stability, we will block you."
    > "Clearly display appropriate data license attribution (ODbL) and the source of your routes (OSRM)."
    > "We don't give any quality guarantees. The Demo Sever is supplied on best effort basis."
[20] https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server — OSRM Demo server
    > "FOSSGIS kindly sponsors an OSRM demo server running worldwide car, foot and bike profiles."
    > "Do not exceed 1 request per second."
[21] https://valhalla.github.io/valhalla/api/route/api-reference — Valhalla Route API reference
    > "Truck costing inherits the auto costing behaviors, but checks for truck access, width and height restrictions, and weight limits on the roads."
    > "Values smaller than 0.5 attempt to avoid tolls and values greater than 0.5 will slightly favor them."
[22] https://developers.google.com/maps/documentation/routes/lvr — Google Routes API: Large vehicle routing
    > "Large vehicle routing is available"
    > "Truck toll prices"
    > "Unsupported features: Large vehicle routing does not support the"
[23] https://developers.google.com/maps/documentation/routes/calculate_toll_fees — Google Routes API: Calculate toll fees
    > "Requests calculating tolls are billed at a higher rate, and the returned estimatedPrice applies to non-commercial vehicles, potentially differing for commercial ones."
[24] https://developers.google.com/maps/billing-and-pricing/pricing — Google Maps Platform pricing
    > "Routes: Compute Routes Essentials"
    > "Routes: Compute Routes Enterprise"
    > "Costs - per 1000 events"
[25] https://developers.google.com/maps/documentation/routes/coverage — Google Routes API coverage
    > "Coverage details for the Routes API are provided on a country-by-country basis, including specifics for two-wheeled vehicles and toll calculations."
[26] https://aws.amazon.com/blogs/startups/blackbuck-builds-future-ready-digital-freight-marketplace-using-aws — AWS Startups blog: BlackBuck digital freight marketplace
    > "is a digital freight marketplace for shippers and truckers to conveniently discover each other"
[27] https://docs.here.com/routing/docs/routing-v8-truck-routing — HERE Routing API v8: Truck routing
    > "Truck routing is enabled by setting transportMode=truck"
[28] https://apeda.gov.in/hortinet-static — APEDA HortiNet
    > "HortiNet collects, stores and reports – forward and backward traces and quality assurance data entered by the stakeholders"
[29] https://www.fao.org/4/w3240e/W3240E12.htm — FAO: Agricultural and Food Marketing Management, Ch.12 Marketing Costs and Margins
    > "the farmer's/grower's share of the retail price paid by the end user or consumer"
