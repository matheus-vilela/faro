/** Score Prazo · Completo · Preciso (0–100) a partir de runs submetidos. */

export type ScoreRunInput = {
  on_time: boolean | null;
  items_total: number;
  items_done: number;
  needs_rework: boolean;
  geofence_ok?: boolean | null;
};

function meanRounded(vals: number[]): number {
  if (vals.length === 0) return 0;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/** No horário = 100; atrasado (se registrado) = 40; sem prazo = 100. */
export function scorePrazo(runs: ScoreRunInput[]): number {
  return meanRounded(runs.map((r) => (r.on_time === false ? 40 : 100)));
}

/** Percentual de itens feitos naquele envio. */
export function scoreCompleto(runs: ScoreRunInput[]): number {
  return meanRounded(
    runs.map((r) => {
      if (r.items_total <= 0) return 100;
      return Math.round((r.items_done / r.items_total) * 100);
    }),
  );
}

/** 100 sem devolução; 45 se o envio está devolvido para refazer. */
export function scorePreciso(runs: ScoreRunInput[]): number {
  return meanRounded(runs.map((r) => (r.needs_rework ? 45 : 100)));
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
