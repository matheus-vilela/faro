export type CompanyAcquirer = {
  id: string;
  company_id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** Slug estável a partir do nome (sem acento, minúsculas, hífens). */
export function acquirerSlugFromName(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug;
}

export function nestedRelation<T>(
  value: T | T[] | null | undefined,
): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
