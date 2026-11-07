export interface EconomicsInputs {
  purchasePrice: number
  salePrice: number
  quantityKg: number
  lossPercent: number
  freight: number
  handling: number
  storage: number
  fees: number
  annualInterestPercent: number
  financingDays: number
  capacityKg: number
}

export type EconomicsResult = ReturnType<typeof calculateEconomics>
export const KG_PER_QUINTAL = 100
export const perQuintalToPerKg = (v: number) => v / KG_PER_QUINTAL

/** All prices INR/kg, costs INR. Simple financing on purchase + operating costs, ACT/365. */
export function calculateEconomics(input: EconomicsInputs) {
  const fields: (keyof EconomicsInputs)[] = ['purchasePrice', 'salePrice', 'quantityKg', 'lossPercent', 'freight', 'handling', 'storage', 'fees', 'annualInterestPercent', 'financingDays', 'capacityKg']
  for (const field of fields) {
    if (typeof input[field] !== 'number' || !Number.isFinite(input[field]) || input[field] < 0) throw new Error(`${field} must be a finite non-negative number. Freight is a mandatory manual assumption.`)
  }
  if (input.quantityKg <= 0) throw new Error('Quantity must be greater than zero.')
  if (input.lossPercent >= 100) throw new Error('Loss must be below 100%.')
  if (input.capacityKg <= 0 || input.quantityKg > input.capacityKg) throw new Error('Quantity exceeds vehicle capacity or capacity is missing.')
  const purchaseCost = input.purchasePrice * input.quantityKg
  const operatingCost = input.freight + input.handling + input.storage + input.fees
  const financingCost = (purchaseCost + operatingCost) * input.annualInterestPercent / 100 * input.financingDays / 365
  const totalCost = purchaseCost + operatingCost + financingCost
  const saleableKg = input.quantityKg * (1 - input.lossPercent / 100)
  const revenue = saleableKg * input.salePrice
  const margin = revenue - totalCost
  const financingFactor = 1 + input.annualInterestPercent / 100 * input.financingDays / 365
  // Freight at which margin is zero, holding every other input (financing applies to freight too).
  const breakEvenFreight = revenue / financingFactor - purchaseCost - (operatingCost - input.freight)
  // Loss % at which saleable revenue equals total cost; null when the sale price is zero.
  const grossRevenue = input.quantityKg * input.salePrice
  const breakEvenLossPercent = grossRevenue > 0 ? (1 - totalCost / grossRevenue) * 100 : null
  const breakEvenPrice = totalCost / saleableKg
  return {
    purchaseCost, operatingCost, financingCost, totalCost, saleableKg, revenue, margin,
    /** Per kg / tonne purchased (pre-loss quantity). */
    marginPerKg: margin / input.quantityKg, marginPerTonne: margin / input.quantityKg * 1000,
    breakEvenPrice, breakEvenPricePerQuintal: breakEvenPrice * 100,
    breakEvenFreight, breakEvenLossPercent,
    /** Margin divided by capital deployed (total cost incl. financing). */
    roiPercent: margin / totalCost * 100,
  }
}
