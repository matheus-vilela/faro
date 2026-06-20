const PRICE_EPS = 1e-9;

/** Atualiza XML/chave da NF-e quando o preço observado renova min ou max. */
export function priceBoundNfeXmlUpdates(params: {
  observed: number;
  prevMin: number | null;
  prevMax: number | null;
  bounds: { min_price: number | null; max_price: number | null };
  chaveNfe: string | null;
  xmlText: string | null;
}): {
  min_price_chave_nfe?: string;
  max_price_chave_nfe?: string;
  min_price_nfe_xml?: string;
  max_price_nfe_xml?: string;
} {
  const chave = params.chaveNfe?.replace(/\D/g, "") ?? "";
  const xml = String(params.xmlText ?? "").trim();
  if (!chave || chave.length !== 44 || !xml.startsWith("<")) return {};

  const { observed, prevMin, prevMax, bounds } = params;
  const out: {
    min_price_chave_nfe?: string;
    max_price_chave_nfe?: string;
    min_price_nfe_xml?: string;
    max_price_nfe_xml?: string;
  } = {};

  const newMin = bounds.min_price;
  const newMax = bounds.max_price;

  if (
    newMin != null &&
    (prevMin == null || observed < prevMin - PRICE_EPS) &&
    Math.abs(observed - newMin) <= PRICE_EPS
  ) {
    out.min_price_chave_nfe = chave;
    out.min_price_nfe_xml = xml;
  }

  if (
    newMax != null &&
    (prevMax == null || observed > prevMax + PRICE_EPS) &&
    Math.abs(observed - newMax) <= PRICE_EPS
  ) {
    out.max_price_chave_nfe = chave;
    out.max_price_nfe_xml = xml;
  }

  return out;
}
