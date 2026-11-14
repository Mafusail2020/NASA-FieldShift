export type Status = 'data' | 'literature' | 'estimate' | 'todo'

export interface Region { id: string; name_en: string; name_uk: string; n_points: number; source: string; status: Status }
export interface Criterion {
  id: string; label: string; value: number | null; unit: string; text: string; source: string; status: Status
  crop?: string | null; norm?: number | null
}
export interface StripMonth { month: number; label: string | null; frac: number | null }
export interface StripSlot { slot: number; crop: string; months: StripMonth[] }
export interface Evaluation { rotation: string[]; years: number[]; criteria: Criterion[]; strip: StripSlot[]; note: string }
export interface Alternative { id: string; name: string; source: string; status: Status; evaluation: Evaluation }
export interface EvaluateResponse { region: string; soil: string; farmer: Evaluation; alternatives: Alternative[] }
