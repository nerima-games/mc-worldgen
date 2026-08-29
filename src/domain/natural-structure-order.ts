import type { NaturalStructurePlan } from './natural-structure-types'

const MIN_PLANS_FOR_ORDERING = 2

export const plansInStableOrder = (plans: ReadonlyArray<NaturalStructurePlan>): ReadonlyArray<NaturalStructurePlan> => {
  if (plans.length < MIN_PLANS_FOR_ORDERING) {
    return plans
  }
  return [...new Map(plans.map((plan) => [plan.id, plan])).values()].sort((left, right) => left.id.localeCompare(right.id))
}
