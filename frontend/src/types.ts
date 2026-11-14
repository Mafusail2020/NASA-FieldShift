export type Status = 'data' | 'literature' | 'estimate' | 'todo'

export interface Region { id: string; name_en: string; name_uk: string }
export interface Criterion {
  id: string; label: string; value: number | null; unit: string; text: string; source: string; status: Status
  crop?: string | null; norm?: number | null; p10?: number | null; by_crop?: Record<string, number> | null; crops?: string[] | null
}
export interface StripMonth { month: number; label: string | null; frac: number | null }
export interface StripSlot { slot: number; crop: string; months: StripMonth[] }
export interface Evaluation { rotation: string[]; years: number[]; criteria: Criterion[]; strip: StripSlot[]; note: string }
export interface Alternative { id: string; name: string; source: string; status: Status; evaluation: Evaluation }
export interface EvaluateResponse { region: string; soil: string; farmer: Evaluation; alternatives: Alternative[] }

export interface CropStress {
  years: number[]; mean_ks_mid: (number | null)[]; water_stress_days: (number | null)[]
  heat_days_1: (number | null)[]; heat_days_2: (number | null)[]
  heat_threshold_1_c: number | null; heat_threshold_2_c: number | null; heat_status: Status; source: string; status: Status
}
export interface Climate {
  region: string; years: number[]; precip_mm: number[]; eto_mm: number[]; july_tmax_c: number[]; source: string; status: Status
  stress: Record<string, CropStress>; frost_status: Status; frost_note: string
}

export interface DefaultRow { crop: string; parameter: string; value: number | null; unit: string; source: string; status: Status }
export interface Defaults { prices_costs: DefaultRow[]; k: DefaultRow[] }
export interface BreakEven { crop: string; k: number; yield_t_ha: number; price_uah_t: number }
export interface Money { rotation: string[]; margins: Record<string, number>; summary: Record<string, number>; break_even: BreakEven[] }
export interface EconomicsResponse {
  region: string; use_k: boolean; farmer: Money; alternatives: Record<string, Money>
  best_alternative_with_k: string; best_alternative_without_k: string; note: string
}
export interface EconomicsRequest { region: string; rotation: string[]; use_k: boolean; price: Record<string, number>; cost: Record<string, number> }
