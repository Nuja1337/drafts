// Page titles: sets document.title while a page is mounted.
import { useEffect } from "react";

export function useTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    const prev = document.title;
    document.title = `${title} · Drafts`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
