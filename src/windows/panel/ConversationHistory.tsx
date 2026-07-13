import { useAppStore } from "../../store/appStore";

export function ConversationHistory() {
  const conversationHistory = useAppStore(
    (appState) => appState.conversationHistory,
  );

  if (conversationHistory.length === 0) {
    return (
      <section className="conversation-history empty">
        <p className="empty-history">No conversation yet.</p>
      </section>
    );
  }

  return (
    <section className="conversation-history">
      {conversationHistory.map(
        (conversationMessage, conversationMessageIndex) => (
          <article
            key={`${conversationMessage.role}-${conversationMessageIndex}`}
          >
            <strong>{conversationMessage.role}</strong>
            <p>{conversationMessage.text}</p>
          </article>
        ),
      )}
    </section>
  );
}
