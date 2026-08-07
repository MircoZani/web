import { ChatClient } from "./ChatClient";

// Route sperimentale, separata da /onboarding + /richiesta + /risultati che
// restano invariate e continuano a servire la beta attuale. Stesso backend,
// stesso /api/recommendations: cambia solo la presentazione (chat invece di
// wizard a pagine).
export default function ChatPage() {
  return <ChatClient />;
}
