import { useEffect, useState } from "react";
import { localDate } from "@/lib/todos";

export function useLocalDate() {
  const [today, setToday] = useState(() => localDate());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function update() {
      clearTimeout(timer);
      setToday(localDate());
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);
      timer = setTimeout(
        update,
        Math.max(1000, midnight.getTime() - Date.now() + 100),
      );
    }
    // Synchronize the calendar day with the clock and resume after sleep.
    // oxlint-disable-next-line react/set-state-in-effect
    update();
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return today;
}
