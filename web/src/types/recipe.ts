/** Lista enxuta para selects (ficha técnica / receita de produtos). */
export interface RecipeListItem {
  id: string;
  name: string;
  batch_yield: number;
  active: boolean | null;
}
