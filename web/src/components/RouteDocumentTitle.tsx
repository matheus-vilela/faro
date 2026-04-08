import { getDocumentTitle } from "@/lib/documentTitle";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/** Atualiza `document.title` conforme a rota atual. */
export function RouteDocumentTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = getDocumentTitle(pathname);
  }, [pathname]);

  return null;
}
