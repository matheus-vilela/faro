/** Score Prazo · Completo · Preciso (0–100) a partir de runs submetidos. */

export type ScoreRunInput = {
  on_time: boolean | null;
  items_total: number;
  items_done: number;
  needs_rework: boolean;
  geofence_ok: boolean | null;
};

export function scorePrazo(runs: ScoreRunInput[]): number {
  if (runs.length === 0) return 70;
  const vals = runs.map((r) =>
    r.on_time === true ? 100 : r.on_time === false ? 40 : 70,
  );
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function scoreCompleto(runs: ScoreRunInput[]): number {
  if (runs.length === 0) return 70;
  const vals = runs.map((r) => {
    if (r.items_total <= 0) return 70;
    return Math.round((r.items_done / r.items_total) * 100);
  });
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function scorePreciso(runs: ScoreRunInput[]): number {
  if (runs.length === 0) return 80;
  const vals = runs.map((r) => {
    if (r.needs_rework) return 45;
    if (r.geofence_ok === false) return 50;
    return 85;
  });
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function staffScoreAxes(runs: ScoreRunInput[]) {
  const prazo = scorePrazo(runs);
  const completo = scoreCompleto(runs);
  const preciso = scorePreciso(runs);
  return {
    prazo,
    completo,
    preciso,
    score: Math.round((prazo + completo + preciso) / 3),
  };
}
