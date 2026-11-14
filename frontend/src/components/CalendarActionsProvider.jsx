import { CalendarActionContext } from '../lib/calendar-action-context';
import { useCalendarActionsState } from '../lib/use-calendar-actions';
import { useLang } from '../lib/lang';
export default function CalendarActionsProvider({ children }) {
  const { lang } = useLang(); const actions = useCalendarActionsState(lang);
  return <CalendarActionContext.Provider value={actions}>{children}</CalendarActionContext.Provider>;
}
