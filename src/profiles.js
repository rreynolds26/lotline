/* ================= Athens-Clarke County zoning profiles =================
   Transcribed from the Code of Athens-Clarke County, Title 9 (Supplement 48, codified through May 5, 2026):
   Tables 9-5-3 (AR), 9-6-3 (IN), 9-7-3 (RS), 9-8-3 (RM), 9-10-3 (C), 9-11-4 (E, I); Sec. 9-15-3 buffers;
   Sec. 9-30-2 parking ratios, 9-30-5 bicycles, 9-30-6 compact stalls, 9-30-9 stall and aisle design. */
const ACC_CODE = 'ACC Code Title 9, Supp. 48 (May 2026)';
const ACC_TRIPS = (id) => (USE_PRESETS[id] || {}).pmPeakTripsPerBasis ?? null;
function accUses(downtown) {
  // Sec. 9-30-2. Ratios are "1 space per X sf of gross floor area" unless noted.
  if (downtown) return [
    { id: 'retail', name: 'Retail / personal service (C-D: none)', basis: 'per_1000_sf', v: 0, vu: 0, trips: ACC_TRIPS('retail') },
    { id: 'office', name: 'Office (C-D: none)', basis: 'per_1000_sf', v: 0, vu: 0, trips: ACC_TRIPS('office') },
    { id: 'medical_office', name: 'Medical office (C-D: none)', basis: 'per_1000_sf', v: 0, vu: 0, trips: ACC_TRIPS('medical_office') },
    { id: 'restaurant_sit_down', name: 'Restaurant (C-D: none)', basis: 'per_1000_sf', v: 0, vu: 0, trips: ACC_TRIPS('restaurant_sit_down') },
    { id: 'restaurant_drive_through', name: 'Drive-through restaurant (C-D: none)', basis: 'per_1000_sf', v: 0, vu: 0, trips: ACC_TRIPS('restaurant_drive_through') },
    { id: 'industrial_warehouse', name: 'Industrial (C-D: none)', basis: 'per_1000_sf', v: 0, vu: 0, trips: ACC_TRIPS('industrial_warehouse') },
    { id: 'self_storage', name: 'Self storage (C-D: none)', basis: 'per_1000_sf', v: 0, vu: 0, trips: ACC_TRIPS('self_storage') },
    { id: 'multifamily', name: 'Multifamily, 1–2 BR (3–4 BR: 2.0)', basis: 'per_unit', v: 0, vu: 1, trips: ACC_TRIPS('multifamily') },
    { id: 'hotel', name: 'Hotel (per guest room)', basis: 'per_unit', v: 0, vu: 1, trips: ACC_TRIPS('hotel') },
    { id: 'mixed_use', name: 'Mixed use (residential only)', basis: 'per_component', v: 0, vu: 1, trips: null },
  ];
  return [
    { id: 'retail', name: 'Retail / personal service (1 per 300 sf)', basis: 'per_sf', v: 300, vu: 0, trips: ACC_TRIPS('retail') },
    { id: 'office', name: 'General office (1 per 450 sf)', basis: 'per_sf', v: 450, vu: 0, trips: ACC_TRIPS('office') },
    { id: 'medical_office', name: 'Medical / dental office (1 per 350 sf)', basis: 'per_sf', v: 350, vu: 0, trips: ACC_TRIPS('medical_office') },
    { id: 'restaurant_sit_down', name: 'Restaurant (1 per 100 sf, or 1 per 4 seats if less)', basis: 'per_sf', v: 100, vu: 0, trips: ACC_TRIPS('restaurant_sit_down') },
    { id: 'restaurant_drive_through', name: 'Drive-through restaurant (1 per 100 sf)', basis: 'per_sf', v: 100, vu: 0, trips: ACC_TRIPS('restaurant_drive_through') },
    { id: 'industrial_warehouse', name: 'Industrial (1 per 700 sf; warehouse is 1 per employee)', basis: 'per_sf', v: 700, vu: 0, trips: ACC_TRIPS('industrial_warehouse') },
    { id: 'self_storage', name: 'Self storage (not listed; planning director decides)', basis: 'per_1000_sf', v: 0.2, vu: 0, trips: ACC_TRIPS('self_storage') },
    { id: 'multifamily', name: 'Multifamily (2.0 for 2+ BR; 1.0–1.5 for studio/1 BR)', basis: 'per_unit', v: 0, vu: 2, trips: ACC_TRIPS('multifamily') },
    { id: 'hotel', name: 'Hotel (1 per guest room, plus 1)', basis: 'per_unit', v: 0, vu: 1, trips: ACC_TRIPS('hotel') },
    { id: 'mixed_use', name: 'Mixed use (retail rate + 2.0 per unit)', basis: 'per_component', v: 3.33, vu: 2, trips: null },
  ];
}
// Shared ACC parking design rules (Sec. 9-30-5, 9-30-6, 9-30-9, 9-15-3).
const ACC_PARKING = {
  'parking.stallWidth': 9, 'parking.stallDepth': 18, 'parking.aisleWidth': 24,
  'parking.compactPercent': 30, 'parking.compactStallWidth': 8, 'parking.compactStallDepth': 16,
  'app.maxParkingPercentOfRequired': 150, 'app.bikeMinimum': 2, 'app.bikePerAutoSpaces': 20,
  'parking.parkingSetbackFromROW': 4, 'zoning.bufferFront': 4, 'zoning.bufferSide': 0, 'zoning.bufferRear': 0,
  'zoning.maxStories': 100,
};
const NONRES_BUFFER = { 'zoning.bufferAdjacentResidential': 20 }; // 20 ft landscape strip (or 10 ft wall, or 50 ft natural)
const resYard = (base, start, perFt) => ({ 'app.resYardBase': base, 'app.resYardHeightStart': start, 'app.resYardPerFt': perFt });
const pct = (landscaped) => ({ 'siteFeatures.landscapeAreaMinPercent': landscaped, 'zoning.minOpenSpace': landscaped, 'zoning.maxImpervious': 100 - landscaped });
// The use a new building starts with in each district, so its parking ratio matches what the district is for.
const ACC_DEFAULT_USE = { 'C-O': 'office', 'E-O': 'office', 'IN': 'office', 'G': 'office', 'P': 'office', 'E-I': 'industrial_warehouse', 'I': 'industrial_warehouse', 'RM-1': 'multifamily', 'RM-2': 'multifamily', 'RM-3': 'multifamily' };
function accDistrict(code, label, v, extra = {}) {
  return {
    group: 'Athens-Clarke County, GA', label: `ACC ${code} · ${label}`, verified: true, district: code,
    note: extra.note || '', uses: accUses(code === 'C-D'),
    values: { ...ACC_PARKING, 'zoning.useType': ACC_DEFAULT_USE[code] || 'retail', ...v, 'zoning.district': code },
  };
}
const ACC_PROFILES = {
  'acc_C-G': accDistrict('C-G', 'Commercial General', { 'zoning.setbackFront': 0, 'zoning.setbackSide': 0, 'zoning.setbackRear': 0, ...resYard(10, 0, 0), ...NONRES_BUFFER, 'zoning.maxFAR': 1.5, 'zoning.maxLotCoverage': 80, ...pct(20), 'zoning.maxHeight': 65, 'zoning.maxDensity': 24 },
    { note: 'No front or side yard; 10 ft yard and 20 ft landscape buffer next to residential. Density is 24 bedrooms per acre.' }),
  'acc_C-D': accDistrict('C-D', 'Commercial Downtown', { 'zoning.setbackFront': 0, 'zoning.setbackSide': 0, 'zoning.setbackRear': 0, ...resYard(0, 0, 0), 'zoning.bufferAdjacentResidential': 0, 'zoning.maxFAR': 5, 'zoning.maxLotCoverage': 100, ...pct(0), 'zoning.maxHeight': 100, 'zoning.maxDensity': 200, 'app.bikeMinimum': 0, 'app.bikePerAutoSpaces': 20, 'parking.parkingSetbackFromROW': 0, 'zoning.bufferFront': 0 },
    { note: 'Non-residential uses need no off-street parking (Sec. 9-10-4). Residential: 1 space per 1–2 BR unit; hotels 1 per room. Downtown design standards (Sec. 9-10-6) set maximum setbacks. Density is 200 bedrooms per acre.' }),
  'acc_C-O': accDistrict('C-O', 'Commercial Office', { 'zoning.setbackFront': 10, 'zoning.setbackSide': 6, 'zoning.setbackRear': 0, ...resYard(10, 30, 1), ...NONRES_BUFFER, 'zoning.maxFAR': 0.75, 'zoning.maxLotCoverage': 65, ...pct(35), 'zoning.maxHeight': 40, 'zoning.maxDensity': 16 },
    { note: 'Next to residential: 10 ft yard plus 1 ft per ft of height over 30 ft. No rear yard is listed. Density is 16 bedrooms per acre.' }),
  'acc_C-N': accDistrict('C-N', 'Commercial Neighborhood', { 'zoning.setbackFront': 10, 'zoning.setbackSide': 6, 'zoning.setbackRear': 0, ...resYard(10, 30, 1), ...NONRES_BUFFER, 'zoning.maxFAR': 0.75, 'zoning.maxLotCoverage': 75, ...pct(25), 'zoning.maxHeight': 65, 'zoning.maxDensity': 16 },
    { note: 'Next to residential: 10 ft yard plus 1 ft per ft of height over 30 ft. Density is 16 bedrooms per acre.' }),
  'acc_C-R': accDistrict('C-R', 'Commercial Rural', { 'zoning.setbackFront': 20, 'zoning.setbackSide': 6, 'zoning.setbackRear': 0, ...resYard(10, 30, 1), ...NONRES_BUFFER, 'zoning.maxFAR': 0.25, 'zoning.maxLotCoverage': 35, ...pct(65), 'zoning.maxHeight': 65, 'zoning.maxDensity': 16 },
    { note: 'Minimum lot 20,000 sf, 100 ft wide, 200 ft deep. Density is 16 bedrooms per acre.' }),
  'acc_E-O': accDistrict('E-O', 'Employment Office', { 'zoning.setbackFront': 10, 'zoning.setbackSide': 0, 'zoning.setbackRear': 0, ...resYard(10, 30, 1), ...NONRES_BUFFER, 'zoning.maxFAR': 0.75, 'zoning.maxLotCoverage': 75, ...pct(25), 'zoning.maxHeight': 65 },
    { note: '10 ft side or rear yard where it faces a street.' }),
  'acc_E-I': accDistrict('E-I', 'Employment Industrial', { 'zoning.setbackFront': 10, 'zoning.setbackSide': 0, 'zoning.setbackRear': 0, ...resYard(10, 30, 1), ...NONRES_BUFFER, 'zoning.maxFAR': 0.75, 'zoning.maxLotCoverage': 85, ...pct(15), 'zoning.maxHeight': 65 },
    { note: 'Performance and design standards in Sec. 9-11-5 and 9-11-6 also apply.' }),
  'acc_I': accDistrict('I', 'Industrial', { 'zoning.setbackFront': 10, 'zoning.setbackSide': 6, 'zoning.setbackRear': 0, ...resYard(10, 30, 1), ...NONRES_BUFFER, 'zoning.maxFAR': 0.75, 'zoning.maxLotCoverage': 95, ...pct(5), 'zoning.maxHeight': 100 },
    { note: 'Performance and design standards in Sec. 9-11-5 and 9-11-6 also apply.' }),
  'acc_IN': accDistrict('IN', 'Institutional', { 'zoning.setbackFront': 10, 'zoning.setbackSide': 6, 'zoning.setbackRear': 0, ...resYard(10, 30, 1), ...NONRES_BUFFER, 'zoning.maxFAR': 2.5, 'zoning.maxLotCoverage': 80, ...pct(20), 'zoning.maxHeight': 65, 'zoning.maxDensity': 16 },
    { note: 'Minimum lot 3 acres. Density is 16 bedrooms per acre.' }),
  'acc_RM-1': accDistrict('RM-1', 'Mixed Density Residential', { 'zoning.setbackFront': 15, 'zoning.setbackSide': 6, 'zoning.setbackRear': 10, 'app.rearYardHeightStart': 25, 'app.rearYardPerFt': 1, ...resYard(0, 0, 0), ...NONRES_BUFFER, 'zoning.maxFAR': 20, 'zoning.maxLotCoverage': 55, ...pct(45), 'zoning.maxHeight': 30, 'zoning.maxDensity': 16, 'app.bikeMinimum': 0 },
    { note: 'Rear yard 10 ft plus 1 ft per ft of height over 25 ft. No FAR limit. Density is 16 bedrooms per acre (a 2 BR unit counts as 2). 20 ft buffer where multifamily abuts single-family.' }),
  'acc_RM-2': accDistrict('RM-2', 'Mixed Density Residential', { 'zoning.setbackFront': 10, 'zoning.setbackSide': 6, 'zoning.setbackRear': 10, 'app.rearYardHeightStart': 25, 'app.rearYardPerFt': 0.5, ...resYard(0, 0, 0), ...NONRES_BUFFER, 'zoning.maxFAR': 20, 'zoning.maxLotCoverage': 65, ...pct(35), 'zoning.maxHeight': 35, 'zoning.maxDensity': 24, 'app.bikeMinimum': 0 },
    { note: 'Rear yard 10 ft plus 0.5 ft per ft of height over 25 ft. No FAR limit. Density is 24 bedrooms per acre.' }),
  'acc_RM-3': accDistrict('RM-3', 'Mixed Density Residential', { 'zoning.setbackFront': 10, 'zoning.setbackSide': 6, 'zoning.setbackRear': 10, 'app.rearYardHeightStart': 25, 'app.rearYardPerFt': 0.5, ...resYard(0, 0, 0), ...NONRES_BUFFER, 'zoning.maxFAR': 20, 'zoning.maxLotCoverage': 75, ...pct(25), 'zoning.maxHeight': 40, 'zoning.maxDensity': 50, 'app.bikeMinimum': 0 },
    { note: 'Rear yard 10 ft plus 0.5 ft per ft of height over 25 ft. No FAR limit. Density is 50 bedrooms per acre.' }),
  ...Object.fromEntries([['RS-40', 50, 18, 25, 25, 35, 0.92], ['RS-25', 20, 10, 20, 35, 30, 1.4], ['RS-15', 20, 8, 20, 40, 30, 2.0], ['RS-8', 15, 6, 10, 45, 30, 3.8], ['RS-5', 15, 6, 10, 50, 30, 6.0]].map(([z, f, s, r, cov, h, du]) => [`acc_${z}`,
    accDistrict(z, 'Single-Family Residential', { 'zoning.setbackFront': f, 'zoning.setbackSide': s, 'zoning.setbackRear': r, ...resYard(0, 0, 0), 'zoning.bufferAdjacentResidential': 0, 'zoning.maxFAR': 20, 'zoning.maxLotCoverage': cov, ...pct(0), 'zoning.maxHeight': h, 'zoning.maxDensity': du, 'app.bikeMinimum': 0, 'app.bikePerAutoSpaces': null },
      { note: `Front yard is ${f} ft or 1 ft per ft of structure height, whichever is greater; walls over 20 ft step back 1 ft per ft. ${du} units per acre applies to subdivisions of 2+ acres. Single-family homes need 2 spaces each.` })])),
  'acc_AR': accDistrict('AR', 'Agricultural Residential', { 'zoning.setbackFront': 30, 'zoning.setbackSide': 15, 'zoning.setbackRear': 30, 'app.rearYardHeightStart': 20, 'app.rearYardPerFt': 1, ...resYard(0, 0, 0), 'zoning.bufferAdjacentResidential': 0, 'zoning.maxFAR': 20, 'zoning.maxLotCoverage': 10, ...pct(0), 'zoning.maxHeight': 50, 'zoning.maxDensity': 0.1, 'app.bikeMinimum': 0 },
    { note: 'Minimum lot 10 acres (conservation subdivisions differ: 40% coverage, 10 ft side yard). Rear yard 30 ft plus 1 ft per ft over 20 ft.' }),
  'acc_G': accDistrict('G', 'Government', { 'zoning.setbackFront': 0, 'zoning.setbackSide': 0, 'zoning.setbackRear': 0, ...resYard(0, 0, 0), 'zoning.bufferAdjacentResidential': 0, 'zoning.maxFAR': 20, 'zoning.maxLotCoverage': 100, ...pct(0), 'zoning.maxHeight': 1000 },
    { note: 'No dimensional standards. Use is set by the owning government; if sold, the land must be rezoned to fit the Future Development Map (Sec. 9-9-1). Plan against the likely future district.' }),
  'acc_P': accDistrict('P', 'Parks', { 'zoning.setbackFront': 0, 'zoning.setbackSide': 0, 'zoning.setbackRear': 0, ...resYard(0, 0, 0), 'zoning.bufferAdjacentResidential': 0, 'zoning.maxFAR': 20, 'zoning.maxLotCoverage': 100, ...pct(0), 'zoning.maxHeight': 1000 },
    { note: 'No dimensional standards. Must be rezoned before private development (Sec. 9-9-1).' }),
};
for (const p of Object.values(ACC_PROFILES)) p.note = `${p.note} Source: ${ACC_CODE}. Parking design: 9×18 stalls, 24 ft back-up aisle, up to 30% compact at 8×16, surface parking capped at 150% of required, bicycles 2 + 1 per 20 auto spaces.`.trim();
Object.assign(PROFILES, ACC_PROFILES);
function accProfileFor(zone) {
  const base = String(zone || '').toUpperCase().replace(/\*|\(.*?\)/g, '').trim();
  return ACC_PROFILES['acc_' + base] ? 'b:acc_' + base : null;
}
