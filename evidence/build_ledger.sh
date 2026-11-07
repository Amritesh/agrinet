#!/bin/bash
# Rebuild the RESEARCH.md citation ledger from fetched pages (logs/research-retrievals.json).
set -e
S=~/.hermes/skills/research/grounded-citations/scripts/sources.py
L="--ledger logs/research-sources.json"
C=logs/research-cache
python3 $S $L reset
a(){ python3 $S $L add "$1" --title "$2"; }
q(){ python3 $S $L quote "$1" --text "$2" --from "$C/$3.txt" >/dev/null && echo "  q$1 ok" || echo "  q$1 FAIL: $2"; }
a "https://www.rbi.org.in/Scripts/PublicationsView.aspx?id=22723" "RBI Working Paper: Price Dynamics of Tomato, Onion and Potato (TOP)"   #1
q 1 "The farmers’ share in the consumer rupee is estimated at around 33 per cent for tomato, 36 per cent for onion and 37 per cent for potato." f512885621
q 1 "tomato farmers on an average receive 33.5 per cent of the consumer’s price in Delhi" f512885621
q 1 "farmers on an average receive 36.2 per cent of the consumers’ rupee which includes cultivation and overhead costs." f512885621
q 1 "farmers receive a share of 36.7 per cent of the consumer rupee (Chart 20)." f512885621
q 1 "Cold storages are the most important selling point for farmers in the potato belt of western Uttar Pradesh." f512885621
q 1 "Potato farmers generally sell their produce to village level aggregators or traders." f512885621
q 1 "who pay the mandi fees (1 per cent), commission charges (4 per cent) and loading/unloading charges (₹ 9.02 per quintal)." f512885621
a "https://data.gov.in/catalog/current-daily-price-various-commodities-various-markets-mandi" "OGD India: Current daily price of various commodities from various markets (Mandi)"  #2
q 2 "It has the wholesale maximum price, minimum price and modal price on daily basis." d70909d718
a "http://www.agritech.tnau.ac.in/ta/amis_ta/pdf/rs/Manual_Agricultural_Prices_Marketing.pdf" "Draft Manual on Agricultural Prices and Marketing (TNAU Agritech copy)"  #3
q 3 "the price at which the majo rity of the day's transactions take place" 8f4b7d723e
q 3 "not prices asked for, or offered, in advance of the transactions being completed" 8f4b7d723e
q 3 "FAO recommends that the concept of \"Fair Average Quality\" should be used as the basis for price reporting." 8f4b7d723e
a "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2251543" "PIB: e-NAM progress and features (2026)"  #4
q 4 "1,656 mandis integrated across 23 States and 4 Union Territories by March 2026." 69bbf916bd
q 4 "including logistics, warehousing, quality assurance, grading and packaging" 69bbf916bd
q 4 "The platform integrates multiple digital payment modes, including NEFT, RTGS, internet banking, and UPI" 69bbf916bd
q 4 "the Electronic Negotiable Warehouse Receipt (e-NWR) system has been integrated with e-NAM" 69bbf916bd
a "https://pib.gov.in/PressReleasePage.aspx?PRID=1622906" "PIB: e-NAM FPO, Logistics and eNWR modules (May 2020)"  #5
q 5 "FPO trade module, Logistics module and eNWR based Warehouse module were launched by the Union Agriculture Minister on 2nd April 2020." 789582cbb5
a "https://agriwelfare.gov.in/sites/default/files/Revised_eNAM_guidelines_Oct2023.pdf" "Revised e-NAM Operational Guidelines (Oct 2023)"  #6
q 6 "to focus on Warehouses Based Sale (WBS) and eNWR trade through e-NAM;" 7799ba99fa
a "https://enam.gov.in/resources/registration-guideline" "e-NAM Registration Guidelines"  #7
q 7 "Once approved by APMC, you will receive eNAM Farmer Permanent Login ID" d90551259f
q 7 "visit your respective Mandi/APMC and verify your License Number." d90551259f
a "https://enam.gov.in/" "e-NAM home"  #8
q 8 "National Agriculture Market (eNAM) is a pan-India electronic trading portal which networks the existing APMC mandis to create a unified national market for agricultural commodities." 72439a3b17
a "https://dfpd.gov.in/WriteReadData/NotificationUploadDocuments/1_360_1_WDandRA_Electronic_Negotiable_Warehouse_Receipts_Regulations_2017.pdf" "WDRA (Electronic Negotiable Warehouse Receipts) Regulations, 2017"  #9
q 9 "shall issue electronic negotiable warehouse receipts only through a repository." 73bd5b53cc
a "https://website.wdra.gov.in/documents/20143/141296131/eNWR+%26+eNAM+process+.pdf/e17528f5-d089-9ec3-158c-78e020b7fa70" "WDRA Model SOP: Deposit, Pledge and Delivery of eNWRs and eNAM"  #10
q 10 "The single source of information for the eNWR will be the Repository;" 9875cb009f
a "https://nccd.gov.in/uploads/ENGINEERING_GUIDELINES_and_MINIMUM_SYSTEM_STANDARDS_FOR_IMPLEMENTATION_IN_COLD_CHAIN_COMPONENTS_2025_3a1cfb0b0a.pdf" "NCCD Engineering Guidelines & Minimum System Standards for Cold Chain Components (2025)"  #11
q 11 "21 Onion 1-3°C 60-65% 4-6 months" 9312dec13d
q 11 "1 Potato (late) 4-12°C 90-95% 5-10 Months" 9312dec13d
q 11 "Initially cold stores were majorly used for storing potatoes" 9312dec13d
q 11 "Definition: Cold Storage type –I -Onion (CS-1- Onion) are cold storages designed for single" 9312dec13d
a "https://www.nhb.gov.in/guidelines/cold-storage-guidelines.html" "NHB cold storage guidelines index"  #12
q 12 "Technical Standards for Cold Storages for Fruits and Vegetables (Uploaded on 9.1.2010)" fc5c3cab51
a "https://nhb.gov.in/pdf/vegetable/potato/pot009.pdf" "NHB: Potato storage"  #13
q 13 "Potatoes in the cold storage are spread over the shelf to a thickness of not more than 30 cm." 47a9223e1e
a "https://www.ams.usda.gov/mnreports/fvdfob.pdf" "USDA AMS National FOB Review (FVDFOB)"  #14
q 14 "Prices represent open (spot) market sales by first handlers on" bdd61248de
q 14 "Delivered Sales, Shipping Point Basis excludes all charges for freight." bdd61248de
a "https://www.ams.usda.gov/market-news/fruit-and-vegetable-shipping-point-market-price-reports" "USDA AMS Specialty Crops Shipping Point Market Price Reports"  #15
q 15 "Prices are differentiated by the commodities’ growing origin, variety, size, package and grade." 0169dbdaea
a "https://www.ams.usda.gov/mnreports/as_fv020.pdf" "USDA AMS Asheville Terminal Market Vegetables Prices"  #16
q 16 "Asheville, NC Terminal Market Vegetables Prices (AS_FV020)" 11f5389c78
a "https://www.fao.org/giews/food-prices/price-tool/en/" "FAO GIEWS: About FPMA Tool"  #17
q 17 "The FPMA Tool is available to countries and regional organizations." 523de62a5d
a "https://www.fao.org/giews/food-prices/home/en/" "FAO GIEWS FPMA home"  #18
q 18 "It provides early warning on high food prices at country level" 33c3c98bb4
a "https://github.com/Project-OSRM/osrm-backend/wiki/API-Usage-Policy" "OSRM API Usage Policy"  #19
q 19 "Excessive use is not allowed. If your requests are impacting the service stability, we will block you." 7f872100ff
q 19 "Clearly display appropriate data license attribution (ODbL) and the source of your routes (OSRM)." 7f872100ff
q 19 "We don't give any quality guarantees. The Demo Sever is supplied on best effort basis." 7f872100ff
a "https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server" "OSRM Demo server"  #20
q 20 "FOSSGIS kindly sponsors an OSRM demo server running worldwide car, foot and bike profiles." c6695012b3
q 20 "Do not exceed 1 request per second." c6695012b3
a "https://valhalla.github.io/valhalla/api/route/api-reference/" "Valhalla Route API reference"  #21
q 21 "Truck costing inherits the auto costing behaviors, but checks for truck access, width and height restrictions, and weight limits on the roads." e51401d5b1
q 21 "Values smaller than 0.5 attempt to avoid tolls and values greater than 0.5 will slightly favor them." e51401d5b1
a "https://developers.google.com/maps/documentation/routes/lvr" "Google Routes API: Large vehicle routing"  #22
q 22 "Large vehicle routing is available" 40f864263d
q 22 "Truck toll prices" 40f864263d
a "https://developers.google.com/maps/documentation/routes/calculate_toll_fees" "Google Routes API: Calculate toll fees"  #23
q 23 "Requests calculating tolls are billed at a higher rate, and the returned estimatedPrice applies to non-commercial vehicles, potentially differing for commercial ones." 0423241282
a "https://developers.google.com/maps/billing-and-pricing/pricing" "Google Maps Platform pricing"  #24
q 24 "Routes: Compute Routes Essentials" 4c32704c74
q 24 "Routes: Compute Routes Enterprise" 4c32704c74
a "https://developers.google.com/maps/documentation/routes/coverage" "Google Routes API coverage"  #25
q 25 "Coverage details for the Routes API are provided on a country-by-country basis, including specifics for two-wheeled vehicles and toll calculations." 3cad49ad4f
a "https://aws.amazon.com/blogs/startups/blackbuck-builds-future-ready-digital-freight-marketplace-using-aws/" "AWS Startups blog: BlackBuck digital freight marketplace"  #26
q 26 "is a digital freight marketplace for shippers and truckers to conveniently discover each other" 755133fdfc
a "https://docs.here.com/routing/docs/routing-v8-truck-routing" "HERE Routing API v8: Truck routing"  #27
q 27 "Truck routing is enabled by setting transportMode=truck" 497d837a2c
a "https://apeda.gov.in/hortinet-static" "APEDA HortiNet"  #28
q 28 "HortiNet collects, stores and reports – forward and backward traces and quality assurance data entered by the stakeholders" c359e1b0a0
a "https://www.fao.org/4/w3240e/W3240E12.htm" "FAO: Agricultural and Food Marketing Management, Ch.12 Marketing Costs and Margins"  #29
q 29 "the farmer's/grower's share of the retail price paid by the end user or consumer" bbc7e298c4
# late additions
q 24 "Costs - per 1000 events" 4c32704c74
q 22 "Unsupported features: Large vehicle routing does not support the" 40f864263d
